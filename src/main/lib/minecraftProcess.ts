import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { platform } from 'node:process'
import type { MinecraftProfile, MinecraftServerStatus, MinecraftConsoleLine } from '@shared/minecraft'
import { findListeningPid, isPidAlive } from './serverProcess'
import { getMinecraftServerPort, writeUserJvmArgs } from './minecraftProperties'
import { sendMinecraftRconCommand } from './minecraftRcon'
import { setMinecraftRunningPid, setMinecraftRunningStartedAt } from '../store'

/** Minecraft's own log line once the world has finished loading and is ready for players -
 *  every vanilla/Fabric/Paper/Spigot/Forge version prints this exact wording (only the
 *  timing number and the surrounding `[HH:MM:SS] [Server thread/INFO]:` prefix vary), so
 *  matching on it rather than a fixed line format keeps this working across launchMode
 *  'jar' and 'script' alike. */
const READY_MARKER = /Done \([\d.]+s\)! For help, type "help"/

/** Caps the in-memory console backlog per running server - purely a live/reconnect buffer
 *  (see shared/minecraft.ts's MVP scope note: no disk-backed backlog across Manager
 *  restarts yet), so this only needs to comfortably cover "opened the Console tab a while
 *  after start", not a whole session's output. */
const CONSOLE_BACKLOG_LIMIT = 500

/** How long stopServer waits for the process to exit on its own (after writing "stop" to
 *  its stdin) before force-killing it. Generous by ARK standards since a world save on
 *  shutdown can legitimately take a while on a large/modded world - there's no Minecraft
 *  equivalent of ARK's separate SaveWorld/DoExit RCON handshake to phase this into, since
 *  the "stop" command already saves and exits on its own. */
const STOP_GRACE_MS = 30_000

interface RunningMinecraftServer {
  /** Null for a server re-adopted from a previous Manager session (see
   *  adoptPersistedMinecraftProcesses) - we have its pid but no live handle: no stdout to
   *  read the console from, no stdin to send commands to (sendStdinCommand/stopServer both
   *  fall back to RCON, when enabled), and no 'exit' event to detect it stopping (which is
   *  why waitForExitOrKill/killServer poll/finalize manually for this case instead). */
  process: ChildProcess | null
  /** Best-known real server pid - used for CPU/RAM stats (minecraftMonitor.ts) and for
   *  force-kill. Starts out equal to `process.pid`, except right after a Windows
   *  launchMode 'script' launch (see watchForScriptPidHandoff below), where it's corrected
   *  once the real java process is found. */
  pid: number
  /** False only for the brief window between a Windows launchMode 'script' launch and the
   *  real java pid being found. During that window, `process.pid` (and therefore the
   *  starting value of `pid` above) is cmd.exe's own wrapper pid, not the actual server -
   *  cmd.exe spawns java as a *child* process rather than replacing itself the way a POSIX
   *  shell's `exec` would, so reading CPU/RAM off it, or killing it, would target the wrong
   *  process entirely (same problem, and same fix, as ARK: Survival Evolved's own .bat
   *  launch - see serverProcess.ts's watchForBatchPidHandoff). */
  pidTracked: boolean
  status: MinecraftServerStatus
}

const running = new Map<string, RunningMinecraftServer>()

/** Kept separate from `running` (rather than as one of its fields) so the console backlog
 *  survives the process exiting - `running`'s entry is deleted the moment the child exits
 *  (see child.on('exit') below), but a server's last output right after it stopped (e.g.
 *  confirming a clean "stop") is exactly when someone's most likely to check the Console tab.
 *  Reset only at the start of a new session (startServer), not on stop/exit. */
const consoleBacklogs = new Map<string, MinecraftConsoleLine[]>()

export const minecraftServerEvents = new EventEmitter()
export const minecraftConsoleEvents = new EventEmitter()

/** Persists a status update (so a later getStatus() call sees it too, not just whoever's
 *  listening for the 'status' event right now) and broadcasts it. */
export function emitStatus(status: MinecraftServerStatus): void {
  const entry = running.get(status.profileId)
  if (entry) entry.status = status
  minecraftServerEvents.emit('status', status)
}

export function getStatus(profileId: string): MinecraftServerStatus {
  return running.get(profileId)?.status ?? { profileId, state: 'stopped' }
}

export function isRunning(profileId: string): boolean {
  return running.has(profileId)
}

/** Clears an entry's bookkeeping (in-memory and persisted pid) and broadcasts 'stopped' -
 *  the one place that needs to happen from, whether triggered by the live child's own
 *  'exit' event or (for an adopted process with no such event - see killServer/
 *  waitForExitOrKill) a poll noticing it's gone. */
function finalizeStopped(profileId: string): void {
  running.delete(profileId)
  setMinecraftRunningPid(profileId, null)
  setMinecraftRunningStartedAt(profileId, null)
  emitStatus({ profileId, state: 'stopped' })
}

/**
 * Re-attaches to servers still running from a previous Manager session - the process itself
 * survives a Manager crash/close (nothing about it is tied to the Manager's own lifetime),
 * so without this a relaunched Manager would show every one of them as "stopped" even while
 * still actually running, and let a second instance be started on top of it. Same shape as
 * ARK's own adoptPersistedProcesses in serverProcess.ts. Console/stdin aren't available for
 * an adopted entry (see RunningMinecraftServer.process's own comment) - CPU/RAM and, if RCON
 * is enabled, player list and command sending still work.
 */
export function adoptPersistedMinecraftProcesses(
  profiles: MinecraftProfile[],
  persistedPids: Record<string, number>,
  persistedStartedAt: Record<string, number> = {}
): void {
  for (const profile of profiles) {
    const pid = persistedPids[profile.id]
    if (pid === undefined) continue

    if (isPidAlive(pid)) {
      const status: MinecraftServerStatus = {
        profileId: profile.id,
        state: 'running',
        pid,
        consoleAvailable: false,
        ...(persistedStartedAt[profile.id] !== undefined ? { startedAt: persistedStartedAt[profile.id] } : {})
      }
      running.set(profile.id, { process: null, pid, pidTracked: true, status })
      consoleBacklogs.set(profile.id, [])
      emitStatus(status)
    } else {
      setMinecraftRunningPid(profile.id, null)
      setMinecraftRunningStartedAt(profile.id, null)
    }
  }
}

/** Whether `getStatus(profileId).pid` is currently trustworthy for an OS-level CPU/RAM
 *  reading - false during the brief window before watchForScriptPidHandoff finds the real
 *  java pid for a Windows launchMode 'script' launch (see RunningMinecraftServer.pidTracked).
 *  Unknown/not-running profiles report true (nothing to distrust). */
export function isPidTracked(profileId: string): boolean {
  return running.get(profileId)?.pidTracked ?? true
}

export function getConsoleBacklog(profileId: string): MinecraftConsoleLine[] {
  return consoleBacklogs.get(profileId) ?? []
}

function appendConsoleLine(profileId: string, text: string): void {
  const line: MinecraftConsoleLine = { text, ts: Date.now() }
  const backlog = consoleBacklogs.get(profileId) ?? []
  backlog.push(line)
  if (backlog.length > CONSOLE_BACKLOG_LIMIT) backlog.shift()
  consoleBacklogs.set(profileId, backlog)
  minecraftConsoleEvents.emit('line', profileId, line)
}

/** Splits a stream of arbitrarily-chunked stdout/stderr data into whole lines, holding back
 *  a trailing partial line until more data completes it - a naive per-chunk split would
 *  otherwise regularly cut a line in half across two 'data' events. */
function makeLineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  let remainder = ''
  return (chunk: Buffer) => {
    remainder += chunk.toString('utf-8')
    const lines = remainder.split(/\r?\n/)
    remainder = lines.pop() ?? ''
    for (const line of lines) {
      if (line) onLine(line)
    }
  }
}

/** -Xms/-Xmx plus any extra JVM flags - shared between jar mode (built straight onto the
 *  java command line below) and script mode (written to user_jvm_args.txt instead, since
 *  the Manager doesn't control that command line - see minecraftProperties.ts). */
function buildJvmArgs(profile: MinecraftProfile): string[] {
  const args = [`-Xms${profile.minMemoryMB}M`, `-Xmx${profile.maxMemoryMB}M`]
  if (profile.extraJvmArgs.trim()) args.push(...profile.extraJvmArgs.trim().split(/\s+/))
  return args
}

function buildJavaArgs(profile: MinecraftProfile): string[] {
  const args = buildJvmArgs(profile)
  args.push('-jar', profile.jarFileName)
  if (profile.extraProgramArgs.trim()) args.push(...profile.extraProgramArgs.trim().split(/\s+/))
  return args
}

/**
 * Polls for the real java process once a Windows launchMode 'script' server's own port
 * starts listening, and switches this profile's tracked pid to it - same technique (and
 * same reason) as ARK: Survival Evolved's watchForBatchPidHandoff in serverProcess.ts:
 * `wrapperPid` is cmd.exe's own pid, not java's, so CPU/RAM stats and force-kill need to
 * target whichever pid is actually holding the server's port instead. Stops on its own once
 * handed off, or once the profile is no longer running under the wrapper pid it started
 * with (findListeningPid is Windows-only, matching the only platform this is called from).
 */
function watchForScriptPidHandoff(profileId: string, port: number, wrapperPid: number, intervalMs = 2000): () => void {
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
        entry.pid = realPid
        entry.pidTracked = true
        entry.status = { ...entry.status, pid: realPid }
        // So a Manager restart re-adopts the real java pid rather than cmd.exe's wrapper
        // pid, which might not even exist any more (or worse, be reused by something
        // unrelated) by the time adoptPersistedMinecraftProcesses runs.
        setMinecraftRunningPid(profileId, realPid)
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

function killByPid(pid: number): void {
  try {
    process.kill(pid)
  } catch {
    // Already gone - nothing to do.
  }
}

export function startServer(profile: MinecraftProfile): MinecraftServerStatus {
  const existing = running.get(profile.id)
  if (existing) return existing.status

  emitStatus({ profileId: profile.id, state: 'starting', startedAt: Date.now() })

  // cmd.exe spawns java as a *child* process rather than replacing itself (unlike a POSIX
  // shell's `exec`, which the fake test server and Forge's own run.sh both use), so on
  // Windows the pid Node hands back for a script launch is cmd.exe's own wrapper pid, not
  // java's - watchForScriptPidHandoff below corrects it once the real process is found.
  const launchedViaWindowsScriptWrapper = profile.launchMode === 'script' && platform === 'win32'

  let child: ChildProcess
  try {
    if (profile.launchMode === 'script') {
      // Modern Forge's generated run.bat/run.sh reads this file for -Xms/-Xmx/extra JVM
      // args - the Manager can't put them on the command line itself in script mode (it
      // executes the script as-is), so this is what makes editing memory in Settings
      // actually take effect for a script-launched server.
      writeUserJvmArgs(profile.installDir, buildJvmArgs(profile))

      const scriptPath = path.join(profile.installDir, profile.scriptFileName)
      // Same cmd.exe /d /c launch shape as ARK: Survival Evolved's own .bat launch (see
      // serverProcess.ts's writeLaunchBatchFile) - spawning a .bat directly is unreliable on
      // Windows, going through cmd.exe is the confirmed-working way to run one. stdio: 'pipe'
      // (unlike ARK, which allocates its own console window) - Java/Minecraft processes
      // support piped stdio reliably, which is what lets the Console tab and sendStdinCommand
      // below work for a script-launched (e.g. modern Forge) server too.
      child =
        platform === 'win32'
          ? spawn('cmd.exe', ['/d', '/c', scriptPath], { cwd: profile.installDir, stdio: 'pipe' })
          : spawn('sh', [scriptPath], { cwd: profile.installDir, stdio: 'pipe' })
    } else {
      child = spawn('java', buildJavaArgs(profile), { cwd: profile.installDir, stdio: 'pipe' })
    }
  } catch (err) {
    const failed: MinecraftServerStatus = { profileId: profile.id, state: 'error', lastError: (err as Error).message }
    emitStatus(failed)
    return failed
  }

  const pid = child.pid
  if (!pid) {
    const failed: MinecraftServerStatus = { profileId: profile.id, state: 'error', lastError: 'Process started without a pid.' }
    emitStatus(failed)
    return failed
  }

  const startedAt = Date.now()
  const status: MinecraftServerStatus = { profileId: profile.id, state: 'starting', pid, startedAt, consoleAvailable: true }
  running.set(profile.id, { process: child, pid, pidTracked: !launchedViaWindowsScriptWrapper, status })
  consoleBacklogs.set(profile.id, [])
  setMinecraftRunningPid(profile.id, pid)
  setMinecraftRunningStartedAt(profile.id, startedAt)
  emitStatus(status)

  const stopPidHandoffWatch = launchedViaWindowsScriptWrapper
    ? watchForScriptPidHandoff(profile.id, getMinecraftServerPort(profile.installDir), pid)
    : () => {}

  const onStdoutLine = makeLineSplitter((line) => {
    appendConsoleLine(profile.id, line)
    if (READY_MARKER.test(line)) {
      const current = running.get(profile.id)
      if (current && current.status.state === 'starting') {
        emitStatus({ ...current.status, state: 'running' })
      }
    }
  })
  const onStderrLine = makeLineSplitter((line) => appendConsoleLine(profile.id, line))
  child.stdout?.on('data', onStdoutLine)
  child.stderr?.on('data', onStderrLine)

  child.on('exit', (code, signal) => {
    stopPidHandoffWatch()
    running.delete(profile.id)
    setMinecraftRunningPid(profile.id, null)
    setMinecraftRunningStartedAt(profile.id, null)
    emitStatus({
      profileId: profile.id,
      state: 'stopped',
      ...(code !== 0 && code !== null ? { lastError: `Process exited with code ${code}${signal ? ` (signal ${signal})` : ''}` } : {})
    })
  })

  child.on('error', (err) => {
    stopPidHandoffWatch()
    running.delete(profile.id)
    setMinecraftRunningPid(profile.id, null)
    setMinecraftRunningStartedAt(profile.id, null)
    emitStatus({ profileId: profile.id, state: 'error', lastError: err.message })
  })

  return status
}

/** Sends a line of input straight to the running process's stdin - the primary way to send
 *  a server command, since Minecraft/Java server processes reliably support piped stdio
 *  (unlike ARK's dedicated server on Windows, which is why ARK is RCON/log-file-only).
 *  Works whether or not RCON is enabled in server.properties. minecraftRcon.ts's
 *  sendMinecraftRconCommand is the secondary path (see ipc/minecraft.ts's send-command
 *  handler), for player-list queries or a server re-adopted from a previous Manager session
 *  (adoptPersistedMinecraftProcesses) - no live stdin handle exists for one of those. */
export function sendStdinCommand(profileId: string, command: string): boolean {
  const entry = running.get(profileId)
  if (!entry?.process?.stdin?.writable) return false
  try {
    entry.process.stdin.write(command.endsWith('\n') ? command : `${command}\n`)
    return true
  } catch (err) {
    console.error(`Failed to write command to Minecraft profile ${profileId}'s stdin:`, (err as Error).message)
    return false
  }
}

/** Waits for the process to exit on its own, or force-kills it after `graceMs`. Two ways of
 *  detecting "it exited": a live child's own 'exit' event, or - for an adopted process with
 *  no such event available (see RunningMinecraftServer.process) - polling isPidAlive. Kills
 *  via entry.pid (the real server pid, not necessarily entry.process's own pid - see
 *  RunningMinecraftServer.pid) rather than entry.process.kill(): after a Windows launchMode
 *  'script' handoff, entry.process is still the cmd.exe wrapper, and killing just that
 *  leaves the real java process it spawned running orphaned in the background. */
async function waitForExitOrKill(entry: RunningMinecraftServer, profileId: string, graceMs: number): Promise<void> {
  const exited = await new Promise<boolean>((resolve) => {
    if (entry.process) {
      const timeout = setTimeout(() => resolve(false), graceMs)
      entry.process.once('exit', () => {
        clearTimeout(timeout)
        resolve(true)
      })
      return
    }
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
    if (!exited && running.has(profileId)) killByPid(entry.pid)
    return
  }
  // Adopted process: no child.on('exit') handler exists to clean up its bookkeeping for us.
  if (!exited) killByPid(entry.pid)
  finalizeStopped(profileId)
}

/** Graceful shutdown: writes "stop" to the process's own stdin, which saves the world, kicks
 *  players, and exits on its own - there's no separate save-then-exit RCON handshake to phase
 *  this into the way ARK's stopServerPhased needs. Waits up to graceMs before force-killing.
 *  An adopted process (see RunningMinecraftServer.process) has no stdin to write to - RCON's
 *  own "stop" command is the only other graceful path available, if RCON happens to be
 *  enabled; otherwise this falls straight through to the wait-then-force-kill below. */
export async function stopServer(profile: MinecraftProfile, graceMs = STOP_GRACE_MS): Promise<MinecraftServerStatus> {
  const entry = running.get(profile.id)
  if (!entry) return { profileId: profile.id, state: 'stopped' }

  emitStatus({ ...entry.status, state: 'stopping' })
  if (!sendStdinCommand(profile.id, 'stop')) {
    const rconResult = await sendMinecraftRconCommand(profile.installDir, 'stop').catch(
      (err: Error) => ({ ok: false, error: err.message }) as const
    )
    if (!rconResult.ok) {
      console.error(
        `Could not gracefully stop ${profile.name} (no stdin, and RCON's own "stop" didn't work either: ${rconResult.error}) - waiting then force-killing.`
      )
    }
  }
  await waitForExitOrKill(entry, profile.id, graceMs)
  return getStatus(profile.id)
}

/** Immediately force-kills the process - no graceful "stop" is sent, so any unsaved world
 *  state since the last autosave is lost. */
export function killServer(profileId: string): MinecraftServerStatus {
  const entry = running.get(profileId)
  if (!entry) return { profileId, state: 'stopped' }
  emitStatus({ ...entry.status, state: 'stopping' })
  // See waitForExitOrKill's comment - entry.pid, not entry.process, for the same reason.
  killByPid(entry.pid)
  // A live process's own child.on('exit') handler (registered in startServer) finalizes it
  // once the kill actually takes effect; an adopted one (entry.process === null) has no
  // such handler, so nothing else would ever clear its bookkeeping without this.
  if (!entry.process) finalizeStopped(profileId)
  return getStatus(profileId)
}
