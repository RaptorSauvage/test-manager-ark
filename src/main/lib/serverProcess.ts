import { spawn, exec, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { platform } from 'node:process'
import { promisify } from 'node:util'
import type { ServerMod, ServerProfile, ServerStatus } from '@shared/types'
import { getGameDefinition } from '@shared/games'
import { sendRconCommand } from './rcon'
import { readAdminPassword } from './config'
import { setRunningPid, setRunningStartedAt } from '../store'
import { delay } from './delay'

const execAsync = promisify(exec)

/** How long to wait after RCON confirms SaveWorld before sending DoExit - the RCON
 *  response only means ARK accepted the command, not that every file under SavedArks has
 *  finished being written. Sending DoExit (or killing the process) too soon risks the
 *  server exiting mid-write, corrupting the save it just claimed to have finished. Same
 *  margin (and same reasoning) as the settle delay before zipping a backup. */
const SAVE_SETTLE_MS = 30_000

/** ARK writes this once the world has actually finished loading and is ready for players. */
const STARTUP_COMPLETE_MARKER = 'Server has completed startup and is now advertising for join'
/** Safety net in case that log line's wording ever changes and the marker stops matching. */
const STARTUP_FALLBACK_MS = 5 * 60 * 1000

export function getLogFilePath(installDir: string): string {
  return path.join(installDir, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log')
}

/**
 * Given the file size we last saw and the current one, returns the byte
 * offset new content should be read from, or null if there's nothing new.
 * A size decrease means the log was rotated/truncated (Unreal starts a
 * fresh log per server session) - in that case we start over from 0 rather
 * than treating the whole new file as "old".
 */
export function computeTailReadStart(previousSize: number, currentSize: number): number | null {
  if (currentSize === previousSize) return null
  if (currentSize < previousSize) return 0
  return previousSize
}

/**
 * Polls the server's own log file, calling onChunk with each newly-written slice of
 * content. We watch the log file rather than the process's stdout because ARK's
 * dedicated server on Windows allocates its own console rather than writing through the
 * standard stdout handle, so piping stdio never sees anything. Content already in the
 * file before watching started is never passed to onChunk, so leftover lines from a
 * previous session can't cause a false match immediately on start. Returns a function
 * that stops watching.
 */
export function watchLogFile(
  installDir: string,
  onChunk: (chunk: string, rotated: boolean) => void,
  intervalMs = 2000
): () => void {
  const logPath = getLogFilePath(installDir)
  let previousSize: number | null = null
  let previousIno: number | null = null
  let stopped = false

  const interval = setInterval(() => {
    fs.stat(logPath, (statErr, stats) => {
      if (stopped || statErr) return

      if (previousSize === null) {
        previousSize = stats.size
        previousIno = stats.ino
        return
      }

      // A changed inode means the file itself was recreated (ARK starts a fresh log per
      // server session), so always re-read from the start in that case - relying on size
      // alone would miss a restart where the new session already writes past the old
      // file's size before our next poll, leaving the tailer reading from a stale offset
      // in the new file and never surfacing anything from it.
      const rotated = stats.ino !== previousIno
      const readStart = rotated ? 0 : computeTailReadStart(previousSize, stats.size)
      previousIno = stats.ino
      if (readStart === null) {
        previousSize = stats.size
        return
      }
      previousSize = stats.size

      const stream = fs.createReadStream(logPath, { start: readStart, encoding: 'utf-8' })
      let chunk = ''
      stream.on('data', (data) => {
        chunk += data
      })
      stream.on('error', () => {})
      stream.on('end', () => {
        if (!stopped) onChunk(chunk, rotated)
      })
    })
  }, intervalMs)

  return () => {
    stopped = true
    clearInterval(interval)
  }
}

/** Watches for `marker` to appear, firing onReady (at most once) the first time it does. */
export function watchLogFileForMarker(
  installDir: string,
  marker: string,
  onReady: () => void,
  intervalMs = 2000
): () => void {
  return watchLogFile(
    installDir,
    (chunk) => {
      if (chunk.includes(marker)) onReady()
    },
    intervalMs
  )
}

interface RunningServer {
  /** Null for a server adopted from a previous app run - we have its pid but no live handle. */
  process: ChildProcess | null
  pid: number
  status: ServerStatus
  /** False once the process we actually spawned has exited but RCON confirmed the server
   *  itself is still up (see handleUnexpectedExit) - `pid` is stale past that point, so
   *  monitor.ts falls back to an RCON-only liveness/player-list check instead of pidusage. */
  pidTracked: boolean
}

const running = new Map<string, RunningServer>()

export const serverEvents = new EventEmitter()

/** Persists a status update (so a later getStatus() call sees it too, not just whoever's
 *  listening for the 'status' event right now) and broadcasts it. */
export function emitStatus(status: ServerStatus): void {
  const entry = running.get(status.profileId)
  if (entry) entry.status = status
  serverEvents.emit('status', status)
}

/** Whether a running profile's pid is still trustworthy for OS-level checks (pidusage,
 *  force-kill) - false after handleUnexpectedExit decided a process hand-off happened
 *  rather than a real stop. Unknown/not-running profiles report true (nothing to distrust). */
export function isPidTracked(profileId: string): boolean {
  return running.get(profileId)?.pidTracked ?? true
}

function finalizeStopped(profileId: string): void {
  running.delete(profileId)
  setRunningPid(profileId, null)
  setRunningStartedAt(profileId, null)
  emitStatus({ profileId, state: 'stopped' })
}

/** True if a process with this pid currently exists (works for any pid, not just our own children). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killByPid(pid: number): void {
  try {
    process.kill(pid)
  } catch {
    // Already gone - nothing to do.
  }
}

/** Finds the pid of whichever process currently holds a TCP port in LISTENING state, via
 *  `netstat` - Windows only (the only platform this app ships a build for). Returns null
 *  on any other platform, or if netstat's output can't be parsed/doesn't have a match, so
 *  callers can fall back gracefully instead of throwing. */
export async function findListeningPid(port: number): Promise<number | null> {
  if (platform !== 'win32') return null
  try {
    const { stdout } = await execAsync('netstat -ano -p TCP')
    const suffix = `:${port}`
    for (const line of stdout.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5) continue
      const [proto, local, foreign, , pid] = parts
      if (proto !== 'TCP' || !local.endsWith(suffix)) continue
      // A listening socket's foreign address is always the "nobody yet" placeholder
      // (0.0.0.0:0 / [::]:0) - checking that instead of the State column keeps this
      // locale-independent, since Windows localizes State text (e.g. "LISTENING" becomes
      // "ÉCOUTE" on a French install) but never the IP literal.
      if (!/^(0\.0\.0\.0|\[::\]):0$/.test(foreign)) continue
      const parsedPid = Number(pid)
      if (Number.isFinite(parsedPid) && parsedPid > 0) return parsedPid
    }
    return null
  } catch {
    return null
  }
}

/** Tries a harmless RCON round-trip a few times, spaced out, to confirm the server is
 *  genuinely still reachable - a couple of retries rather than one shot, since a process
 *  hand-off (see handleUnexpectedExit) can leave RCON briefly unreachable for a moment
 *  right as the new process takes over. */
export async function confirmAliveViaRcon(profile: ServerProfile, attempts = 3, delayMs = 2000): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await delay(delayMs)
    const result = await sendRconCommand(profile, 'ListPlayers')
    if (result.ok) return true
  }
  return false
}

/**
 * The process we actually spawned exited, but nothing asked it to - on some recent ARK
 * builds, the dedicated server hands off to a new underlying process shortly after
 * finishing startup (the game itself keeps running, just no longer under the pid we
 * originally tracked), and Node correctly reports that hand-off as our child exiting. A
 * lost child process isn't by itself proof the server actually stopped, so before believing
 * it, ask the server directly over RCON - the one channel that doesn't care which OS
 * process is actually serving it. If RCON still answers, keep the entry as running but stop
 * trusting `pid` for OS-level checks (CPU/RAM monitoring, force-kill) until it either comes
 * back later or genuinely goes offline. If RCON doesn't answer either, this was a real,
 * unexpected stop (a crash) - finalize it as stopped like before.
 */
export async function handleUnexpectedExit(profile: ServerProfile): Promise<void> {
  const entry = running.get(profile.id)
  if (!entry) return

  const stillAlive = await confirmAliveViaRcon(profile)
  const current = running.get(profile.id)
  if (!current) return // stopped/restarted for real while we were checking

  if (stillAlive) {
    // RCON only answers if some process is holding that port, so whichever pid netstat
    // reports for it is unambiguously the new process - re-attach full pid-based
    // monitoring (CPU/RAM, force-kill) to it rather than settling for the degraded,
    // RCON-only fallback.
    const newPid = await findListeningPid(profile.rconPort)
    if (newPid && isPidAlive(newPid)) {
      console.warn(
        `${profile.name}: its process exited unexpectedly but RCON still responds - re-attached to the new process (pid ${newPid}) that took over.`
      )
      current.process = null
      current.pid = newPid
      current.pidTracked = true
      current.status = { ...current.status, pid: newPid }
      setRunningPid(profile.id, newPid)
      emitStatus(current.status)
      return
    }

    console.warn(
      `${profile.name}: its process exited unexpectedly but RCON still responds - assuming a hand-off to a new process and continuing to monitor it without pid tracking.`
    )
    current.process = null
    current.pidTracked = false
    return
  }

  finalizeStopped(profile.id)
}

const updatingProfiles = new Set<string>()

/** Marks a profile as being updated via SteamCMD (or not), pushing the new status to listeners. */
export function setUpdating(profileId: string, value: boolean): void {
  if (value) updatingProfiles.add(profileId)
  else updatingProfiles.delete(profileId)
  emitStatus(getStatus(profileId))
}

export function isUpdating(profileId: string): boolean {
  return updatingProfiles.has(profileId)
}

export function getExecutablePath(profile: ServerProfile): string {
  const def = getGameDefinition(profile.game)
  const relPath = platform === 'win32' ? def.executableWin : def.executableLinux
  return path.join(profile.installDir, ...relPath.split('/'))
}

/**
 * Builds the ARK launch command line: `<Map>?param=value?param=value -flag -flag=value`.
 * Shared across ARK: Survival Ascended and ARK: Survival Evolved (ASE predates ASA and most
 * of this flag surface carries over unchanged), except where marked otherwise below.
 * Exact flags can drift between game updates - `extraArgs` on the profile is the
 * escape hatch for anything not covered here.
 */
export function buildLaunchArgs(profile: ServerProfile, adminPasswordOverride?: string): string[] {
  const isEvolved = profile.game === 'ark-evolved'
  const adminPassword = adminPasswordOverride ?? readAdminPassword(profile.installDir)

  let args: string[]

  if (isEvolved) {
    // Every detail here - the exact ?-string param order and the exact flag order below -
    // is copied from a real, working ShooterGameServer.exe command line, confirmed the hard
    // way: reordering these (e.g. putting -servergamelog right after the map string instead
    // of after -NoBattlEye/-ForceRespawnDinos, like the ARK: Survival Ascended shape used to)
    // reproducibly caused a blocking "Plugin 'RuntimeMeshComponent' failed to load" dialog on
    // launch. Why order would matter for a plugin load isn't obvious, but the fix is
    // empirically confirmed, so it's kept exact here rather than normalized.
    const params = [
      `Port=${profile.gamePort}`,
      `QueryPort=${profile.queryPort}`,
      `RCONPort=${profile.rconPort}`,
      'RCONEnabled=True',
      `MaxPlayers=${profile.maxPlayers}`
    ]
    if (adminPassword) params.push(`ServerAdminPassword=${adminPassword}`)
    // SessionName=/ServerPassword= are mandatory for ARK: Survival Evolved - always emitted,
    // even blank (a blank ServerPassword= means no join password required, a valid, common
    // setting).
    params.push(`SessionName=${profile.sessionName}`, `ServerPassword=${profile.serverPassword}`)

    args = [`${profile.map}?${params.join('?')}`]
    if (profile.disableBattlEye) args.push('-NoBattlEye')
    if (profile.forceRespawnDinos) args.push('-ForceRespawnDinos')
    args.push('-servergamelog')
    if (profile.rconTribeLog) args.push('-servergamelogincludetribelogs', '-ServerRCONOutputTribeLogs')
  } else {
    const params = ['listen', `Port=${profile.gamePort}`, 'RCONEnabled=True', `RCONPort=${profile.rconPort}`]
    if (adminPassword) params.push(`ServerAdminPassword=${adminPassword}`)

    args = [
      `${profile.map}?${params.join('?')}`,
      '-server',
      '-log',
      `-ServerPlatform=${profile.serverPlatform}`,
      `-WinLiveMaxPlayers=${profile.maxPlayers}`
    ]
  }

  const enabledMods = profile.mods.filter((mod) => mod.enabled)
  const formatModId = (mod: ServerMod): string => (mod.dev ? `${mod.id}-dev` : mod.id)
  // Passive mods (-passivemods=, and the -dev suffix) are an ARK: Survival Ascended addition
  // with unconfirmed ARK: Survival Evolved support - on an ASE profile a passive-flagged mod
  // is simply loaded as a normal active mod instead of being dropped entirely, since that's
  // closer to what enabling it was actually meant to do.
  const activeModIds = enabledMods.filter((mod) => profile.game !== 'ark-ascended' || !mod.passive).map(formatModId)
  if (activeModIds.length > 0) {
    args.push(`-mods=${activeModIds.join(',')}`)
  }
  if (profile.game === 'ark-ascended') {
    const passiveModIds = enabledMods.filter((mod) => mod.passive).map(formatModId)
    if (passiveModIds.length > 0) args.push(`-passivemods=${passiveModIds.join(',')}`)
  }

  if (profile.clusterEnabled) {
    if (profile.clusterId.trim()) args.push(`-clusterid=${profile.clusterId.trim()}`)
    if (profile.clusterDirOverride.trim()) args.push(`-ClusterDirOverride=${profile.clusterDirOverride.trim()}`)
    if (profile.noTransferFromFiltering) args.push('-NoTransferFromFiltering')
    if (profile.externalIp.trim()) args.push(`-ServerIP=${profile.externalIp.trim()}`)
  }

  if (profile.cultureSettings !== 'none') args.push(`-culture=${profile.cultureSettings}`)
  // Already pushed above, in the exact confirmed position, for ARK: Survival Evolved.
  if (!isEvolved) {
    if (profile.disableBattlEye) args.push('-NoBattlEye')
    if (profile.rconTribeLog) args.push('-servergamelogincludetribelogs', '-ServerRCONOutputTribeLogs')
    if (profile.forceRespawnDinos) args.push('-ForceRespawnDinos')
  }
  if (profile.noSound) args.push('-nosound')
  // -DestroyTamesOverLevel= is an ARK: Survival Ascended addition with unconfirmed ARK:
  // Survival Evolved support - never emitted for it (see shared/games.ts). Falls back to ''
  // for a profile saved before this field existed and read some way that bypasses store.ts's
  // own migrateProfile backfill (e.g. a test fixture) - never throws.
  if (profile.game === 'ark-ascended' && (profile.maxDinoLevel ?? '').trim()) {
    args.push(`-DestroyTamesOverLevel=${profile.maxDinoLevel.trim()}`)
  }
  if (profile.moddedMapEnabled && profile.moddedMapId.trim()) args.push(`-MapModID=${profile.moddedMapId.trim()}`)

  if (profile.extraArgs.trim()) {
    args.push(...profile.extraArgs.trim().split(/\s+/))
  }
  // extraArgs is free text the user maintains themselves - a flag added there before the
  // Manager natively supported it (e.g. -servergamelog, -nosound, -NoBattlEye) would otherwise
  // end up on the command line twice once the Manager starts emitting it too. Keeping only the
  // first occurrence of each exact token (the map string at index 0 is always kept, since it's
  // never a duplicate of anything else) is a no-op for a profile whose extraArgs doesn't
  // overlap with the rest, and silently fixes it for one that does.
  const seen = new Set<string>()
  return args.filter((arg, index) => {
    if (index === 0 || !seen.has(arg)) {
      seen.add(arg)
      return true
    }
    return false
  })
}

export function getStatus(profileId: string): ServerStatus {
  if (updatingProfiles.has(profileId)) {
    return { profileId, state: 'updating' }
  }
  return running.get(profileId)?.status ?? { profileId, state: 'stopped' }
}

export function isRunning(profileId: string): boolean {
  return running.has(profileId)
}

/** Marks a still-alive pid from a previous app run as running again, so this session can manage it. */
export function markProcessExited(profileId: string): void {
  finalizeStopped(profileId)
}

/**
 * On app startup, re-attach to servers that are still running from a previous
 * session (the process itself survives a Manager crash/close - see startServer).
 * Without this, a relaunched app would "forget" about them and let the user
 * start a second instance on the same ports.
 */
export function adoptPersistedProcesses(
  profiles: ServerProfile[],
  persistedPids: Record<string, number>,
  persistedStartedAt: Record<string, number> = {}
): void {
  for (const profile of profiles) {
    const pid = persistedPids[profile.id]
    if (pid === undefined) continue

    if (isPidAlive(pid)) {
      const status: ServerStatus = {
        profileId: profile.id,
        state: 'running',
        pid,
        ...(persistedStartedAt[profile.id] !== undefined ? { startedAt: persistedStartedAt[profile.id] } : {})
      }
      running.set(profile.id, { process: null, pid, status, pidTracked: true })
      // Broadcasts the same way a fresh start does, so anything listening for a
      // running-transition (e.g. serverVersionWatcher.ts) treats an adopted server the
      // same as one this session actually started - no renderer window exists yet to
      // receive it at this point in app startup, so this is purely for other main-process
      // listeners registered before this runs.
      emitStatus(status)
    } else {
      setRunningPid(profile.id, null)
      setRunningStartedAt(profile.id, null)
    }
  }
}

/**
 * Writes a temporary launch script for `profile` and returns its path. Every established
 * ARK: Survival Evolved server manager launches through a .bat rather than calling
 * ShooterGameServer.exe directly - its command-line parsing is a much older, less rigorous
 * UE4 codebase than ARK: Survival Ascended's, and going through cmd.exe (with the raw,
 * unquoted command line exactly as a person would type it) is the confirmed-working way to
 * reach it, rather than relying on getting Node's own Windows argument quoting to line up
 * with what it expects. Regenerated fresh on every start, at a stable per-profile path under
 * the OS temp dir so it's easy to find and inspect without touching the install directory.
 */
function writeLaunchBatchFile(profile: ServerProfile, exe: string, args: string[]): string {
  const batPath = path.join(os.tmpdir(), `ark-manager-launch-${profile.id}.bat`)
  const commandLine = [path.basename(exe), ...args].join(' ')
  fs.writeFileSync(batPath, `@echo off\r\ncd /d "${path.dirname(exe)}"\r\n${commandLine}\r\n`, 'utf-8')
  return batPath
}

/**
 * A .bat-launched server's `child.pid` (see writeLaunchBatchFile) is cmd.exe's own pid, not
 * ShooterGameServer.exe's - cmd.exe stays alive as its parent for as long as the batch script
 * runs. Polls for whichever process actually holds `port` (the same `findListeningPid`
 * technique handleUnexpectedExit already uses for a hand-off) and switches this profile's
 * tracked pid to it once found, nulling out `process` too so killServer/waitForExitOrKill fall
 * through to killing that real pid directly instead of the now-irrelevant cmd.exe wrapper -
 * exactly the same re-attach shape handleUnexpectedExit uses. Until this fires, CPU/RAM
 * monitoring is unavailable (pidTracked stays false) rather than misleadingly reporting
 * cmd.exe's own near-zero usage. Stops on its own once handed off, or once the profile is no
 * longer running under the wrapper pid it started with.
 */
function watchForBatchPidHandoff(profileId: string, port: number, wrapperPid: number, intervalMs = 2000): () => void {
  let stopped = false
  const interval = setInterval(() => {
    if (stopped) return
    void (async () => {
      const entry = running.get(profileId)
      if (!entry || entry.pid !== wrapperPid) {
        stopped = true
        clearInterval(interval)
        return
      }
      const realPid = await findListeningPid(port)
      if (realPid && realPid !== wrapperPid && isPidAlive(realPid)) {
        entry.process = null
        entry.pid = realPid
        entry.pidTracked = true
        entry.status = { ...entry.status, pid: realPid }
        setRunningPid(profileId, realPid)
        emitStatus(entry.status)
        stopped = true
        clearInterval(interval)
      }
    })()
  }, intervalMs)
  return () => {
    stopped = true
    clearInterval(interval)
  }
}

export function startServer(profile: ServerProfile): ServerStatus {
  if (running.has(profile.id)) {
    return running.get(profile.id)!.status
  }

  const exe = getExecutablePath(profile)
  const args = buildLaunchArgs(profile)

  emitStatus({ profileId: profile.id, state: 'starting', startedAt: Date.now() })

  // ARK: Survival Evolved goes through a .bat/cmd.exe, like every established ARK: Survival
  // Evolved server manager does - see writeLaunchBatchFile. ARK: Survival Ascended keeps the
  // direct spawn, unaffected. Windows-only (a .bat is a Windows concept), matching the only
  // platform this app ships a build for; falls back to the direct spawn elsewhere (e.g. Linux
  // test/dev runs of this codebase).
  const launchViaBatch = profile.game === 'ark-evolved' && platform === 'win32'

  let child: ChildProcess
  try {
    // stdio: 'ignore' - ARK's dedicated server allocates its own console on
    // Windows rather than writing through the standard stdout handle, so
    // piping it never sees anything; the startup-complete marker is instead
    // read from the server's own log file (see watchLogFileForMarker).
    // detached + unref - the server must keep running even if this Manager
    // crashes or is closed; without detaching, Windows ties child processes to
    // the parent's job object and kills them the moment the parent dies.
    // cwd: the executable's own directory (Win64/Linux), not the install root - every
    // community-standard ARK launch script `cd`s into that folder before running the exe
    // (a manually confirmed working ARK: Survival Evolved launch, for instance, was run from
    // its own Win64 folder), and this keeps the Manager's spawn matching that exactly rather
    // than leaving a working-directory mismatch as one more unverified difference.
    if (launchViaBatch) {
      const batPath = writeLaunchBatchFile(profile, exe, args)
      child = spawn('cmd.exe', ['/d', '/c', batPath], { cwd: path.dirname(exe), stdio: 'ignore', detached: true })
    } else {
      // windowsVerbatimArguments: true - Node's default Windows quoting wraps a space-
      // containing argument in double quotes, the normally-correct thing to do for a
      // well-behaved argv parser. Harmless no-op here (ARK: Survival Ascended's arguments
      // never contain a bare space) and ignored on non-Windows platforms; kept for parity in
      // case that ever changes.
      child = spawn(exe, args, { cwd: path.dirname(exe), stdio: 'ignore', detached: true, windowsVerbatimArguments: true })
    }
    child.unref()
  } catch (err) {
    const failed: ServerStatus = { profileId: profile.id, state: 'error', lastError: (err as Error).message }
    emitStatus(failed)
    return failed
  }

  const pid = child.pid
  if (!pid) {
    const failed: ServerStatus = { profileId: profile.id, state: 'error', lastError: 'Process started without a pid.' }
    emitStatus(failed)
    return failed
  }

  // Still "starting" here - the OS process exists, but ARK itself hasn't
  // finished loading the world yet. We only flip to "running" once we see
  // the startup-complete marker (or the fallback timeout below fires).
  const startedAt = Date.now()
  const status: ServerStatus = {
    profileId: profile.id,
    state: 'starting',
    pid,
    startedAt
  }
  // launchViaBatch: `pid` is cmd.exe's own pid, not the real ShooterGameServer.exe's - not
  // trustworthy for OS-level checks (CPU/RAM, force-kill) until watchForBatchPidHandoff below
  // finds the real one.
  running.set(profile.id, { process: child, pid, status, pidTracked: !launchViaBatch })
  setRunningPid(profile.id, pid)
  setRunningStartedAt(profile.id, startedAt)
  emitStatus(status)

  const fallback = setTimeout(() => markReady(), STARTUP_FALLBACK_MS)
  const stopWatchingLog = watchLogFileForMarker(profile.installDir, STARTUP_COMPLETE_MARKER, () => markReady())
  const stopBatchPidHandoff = launchViaBatch ? watchForBatchPidHandoff(profile.id, profile.rconPort, pid) : () => {}

  function markReady(): void {
    clearTimeout(fallback)
    stopWatchingLog()
    const entry = running.get(profile.id)
    if (entry && entry.status.state === 'starting') {
      emitStatus({ ...entry.status, state: 'running' })
    }
  }

  child.on('exit', () => {
    clearTimeout(fallback)
    stopWatchingLog()
    stopBatchPidHandoff()
    const entry = running.get(profile.id)
    // A deliberate stop/kill/restart already flips the status to 'stopping'/'restarting'
    // before it ever touches the process - so seeing it exit from one of those states is
    // expected, not a surprise, and there's nothing to double-check. Anything else (still
    // 'starting' or 'running') is an exit nobody asked for.
    const expected = !entry || entry.status.state === 'stopping' || entry.status.state === 'restarting'
    if (expected) {
      finalizeStopped(profile.id)
      return
    }
    void handleUnexpectedExit(profile)
  })

  child.on('error', (err) => {
    clearTimeout(fallback)
    stopWatchingLog()
    stopBatchPidHandoff()
    emitStatus({ profileId: profile.id, state: 'error', lastError: err.message })
  })

  return status
}

/** Waits for the process to exit on its own, or force-kills it after `graceMs`. */
async function waitForExitOrKill(entry: RunningServer, profileId: string, graceMs: number): Promise<void> {
  const exited = await new Promise<boolean>((resolve) => {
    if (entry.process) {
      const timeout = setTimeout(() => resolve(false), graceMs)
      entry.process.once('exit', () => {
        clearTimeout(timeout)
        resolve(true)
      })
      return
    }

    // Adopted process - no 'exit' event available, so poll for liveness instead.
    const start = Date.now()
    const interval = setInterval(() => {
      const alive = isPidAlive(entry.pid)
      if (!alive || Date.now() - start >= graceMs) {
        clearInterval(interval)
        resolve(!alive)
      }
    }, 1000)
  })

  if (entry.process) {
    if (!exited && running.has(profileId)) {
      entry.process.kill()
    }
    return
  }

  // Adopted process: nothing else will clean up its bookkeeping for us.
  if (!exited) killByPid(entry.pid)
  finalizeStopped(profileId)
}

export interface StopPhases {
  /** Resolves as soon as SaveWorld's RCON outcome is known - true only if it was
   *  confirmed before DoExit was sent. Lets a caller that just wants proof a save was
   *  attempted return without waiting out the rest of the shutdown below. */
  saved: Promise<boolean>
  /** Resolves once the process has actually exited (or been force-killed after the
   *  grace period) - the same completion `stopServer` itself waits for. */
  finished: Promise<ServerStatus>
}

/**
 * Graceful shutdown, split into two independently-awaitable phases: SaveWorld, wait for
 * its RCON confirmation, wait saveSettleMs for the save to actually finish writing to
 * disk, then DoExit. DoExit is only sent once SaveWorld is confirmed - if RCON is
 * unreachable or the save fails, there is no safe orderly path, so we skip straight to
 * the grace-period/kill fallback instead of exiting (or waiting) on an unconfirmed save.
 */
export function stopServerPhased(
  profile: ServerProfile,
  graceMs = 15000,
  transientState: 'stopping' | 'restarting' = 'stopping',
  saveSettleMs = SAVE_SETTLE_MS
): StopPhases {
  const entry = running.get(profile.id)
  if (!entry) {
    return {
      saved: Promise.resolve(false),
      finished: Promise.resolve({ profileId: profile.id, state: 'stopped' })
    }
  }

  emitStatus({ ...entry.status, state: transientState })

  let resolveSaved!: (saved: boolean) => void
  const saved = new Promise<boolean>((resolve) => {
    resolveSaved = resolve
  })

  const finished = (async () => {
    const saveResult = await sendRconCommand(profile, 'SaveWorld')
    resolveSaved(saveResult.ok)
    if (saveResult.ok) {
      await delay(saveSettleMs)
      await sendRconCommand(profile, 'DoExit')
    }
    await waitForExitOrKill(entry, profile.id, graceMs)
    return getStatus(profile.id)
  })()

  return { saved, finished }
}

export async function stopServer(
  profile: ServerProfile,
  graceMs = 15000,
  transientState: 'stopping' | 'restarting' = 'stopping',
  saveSettleMs = SAVE_SETTLE_MS
): Promise<ServerStatus> {
  return stopServerPhased(profile, graceMs, transientState, saveSettleMs).finished
}

/** Same restart, split the same way as stopServerPhased - `saved` resolves once the
 *  shutdown's SaveWorld is confirmed, `finished` once the new process has actually
 *  spawned back up. */
export function restartServerPhased(profile: ServerProfile, saveSettleMs = SAVE_SETTLE_MS): StopPhases {
  const { saved, finished: stopFinished } = stopServerPhased(profile, 15000, 'restarting', saveSettleMs)
  const finished = stopFinished.then(() => startServer(profile))
  return { saved, finished }
}

export async function restartServer(profile: ServerProfile, saveSettleMs = SAVE_SETTLE_MS): Promise<ServerStatus> {
  return restartServerPhased(profile, saveSettleMs).finished
}

/** Immediately force-kills the process with no SaveWorld/DoExit - current world state since the last save is lost. */
export function killServer(profileId: string): ServerStatus {
  const entry = running.get(profileId)
  if (!entry) return { profileId, state: 'stopped' }

  emitStatus({ ...entry.status, state: 'stopping' })

  if (entry.process) {
    entry.process.kill()
  } else {
    killByPid(entry.pid)
    finalizeStopped(profileId)
  }

  return getStatus(profileId)
}
