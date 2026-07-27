import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { platform } from 'node:process'
import type { ServerProfile, ServerStatus } from '@shared/types'
import { sendRconCommand } from './rcon'
import { readAdminPassword } from './config'
import { setRunningPid } from '../store'

/** ARK writes this once the world has actually finished loading and is ready for players. */
const STARTUP_COMPLETE_MARKER = 'Server has completed startup and is now advertising for join'
/** Safety net in case that log line's wording ever changes and the marker stops matching. */
const STARTUP_FALLBACK_MS = 5 * 60 * 1000

function getLogFilePath(installDir: string): string {
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
 * Polls the server's own log file for `marker`, calling onReady the first
 * time it shows up in newly-written content. We watch the log file rather
 * than the process's stdout because ARK's dedicated server on Windows
 * allocates its own console rather than writing through the standard stdout
 * handle, so piping stdio never sees anything. Content already in the file
 * before watching started is never matched, so a leftover marker line from
 * a previous session can't cause a false "ready" immediately on start.
 * Returns a function that stops watching.
 */
export function watchLogFileForMarker(
  installDir: string,
  marker: string,
  onReady: () => void,
  intervalMs = 2000
): () => void {
  const logPath = getLogFilePath(installDir)
  let previousSize: number | null = null
  let stopped = false

  const interval = setInterval(() => {
    fs.stat(logPath, (statErr, stats) => {
      if (stopped || statErr) return

      if (previousSize === null) {
        previousSize = stats.size
        return
      }

      const readStart = computeTailReadStart(previousSize, stats.size)
      if (readStart === null) return
      previousSize = stats.size

      const stream = fs.createReadStream(logPath, { start: readStart, encoding: 'utf-8' })
      let chunk = ''
      stream.on('data', (data) => {
        chunk += data
      })
      stream.on('error', () => {})
      stream.on('end', () => {
        if (!stopped && chunk.includes(marker)) onReady()
      })
    })
  }, intervalMs)

  return () => {
    stopped = true
    clearInterval(interval)
  }
}

interface RunningServer {
  /** Null for a server adopted from a previous app run - we have its pid but no live handle. */
  process: ChildProcess | null
  pid: number
  status: ServerStatus
}

const running = new Map<string, RunningServer>()

export const serverEvents = new EventEmitter()

function emitStatus(status: ServerStatus): void {
  const entry = running.get(status.profileId)
  if (entry) entry.status = status
  serverEvents.emit('status', status)
}

function finalizeStopped(profileId: string): void {
  running.delete(profileId)
  setRunningPid(profileId, null)
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
  if (platform === 'win32') {
    return path.join(profile.installDir, 'ShooterGame', 'Binaries', 'Win64', 'ArkAscendedServer.exe')
  }
  return path.join(profile.installDir, 'ShooterGame', 'Binaries', 'Linux', 'ArkAscendedServer')
}

/**
 * Builds the ARK launch command line: `<Map>?param=value?param=value -flag -flag=value`.
 * Exact flags can drift between game updates - `extraArgs` on the profile is the
 * escape hatch for anything not covered here.
 */
export function buildLaunchArgs(profile: ServerProfile, adminPasswordOverride?: string): string[] {
  const adminPassword = adminPasswordOverride ?? readAdminPassword(profile.installDir)
  const params = ['listen', `Port=${profile.gamePort}`, 'RCONEnabled=True', `RCONPort=${profile.rconPort}`]
  if (adminPassword) params.push(`ServerAdminPassword=${adminPassword}`)

  const args = [
    `${profile.map}?${params.join('?')}`,
    '-server',
    '-log',
    `-ServerPlatform=${profile.serverPlatform}`,
    `-WinLiveMaxPlayers=${profile.maxPlayers}`
  ]
  const enabledModIds = profile.mods
    .filter((mod) => mod.enabled)
    .map((mod) => (mod.dev ? `${mod.id}-dev` : mod.id))
  if (enabledModIds.length > 0) {
    args.push(`-mods=${enabledModIds.join(',')}`)
  }

  if (profile.clusterEnabled) {
    if (profile.clusterId.trim()) args.push(`-clusterid=${profile.clusterId.trim()}`)
    if (profile.clusterDirOverride.trim()) args.push(`-ClusterDirOverride=${profile.clusterDirOverride.trim()}`)
    if (profile.noTransferFromFiltering) args.push('-NoTransferFromFiltering')
    if (profile.externalIp.trim()) args.push(`-ServerIP=${profile.externalIp.trim()}`)
  }

  if (profile.cultureSettings !== 'none') args.push(`-culture=${profile.cultureSettings}`)
  if (profile.disableBattlEye) args.push('-NoBattlEye')
  if (profile.rconTribeLog) args.push('-servergamelogincludetribelogs', '-ServerRCONOutputTribeLogs')
  if (profile.forceRespawnDinos) args.push('-ForceRespawnDinos')
  if (profile.noSound) args.push('-nosound')
  if (profile.moddedMapEnabled && profile.moddedMapId.trim()) args.push(`-MapModID=${profile.moddedMapId.trim()}`)

  if (profile.extraArgs.trim()) {
    args.push(...profile.extraArgs.trim().split(/\s+/))
  }
  return args
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
export function adoptPersistedProcesses(profiles: ServerProfile[], persistedPids: Record<string, number>): void {
  for (const profile of profiles) {
    const pid = persistedPids[profile.id]
    if (pid === undefined) continue

    if (isPidAlive(pid)) {
      running.set(profile.id, {
        process: null,
        pid,
        status: { profileId: profile.id, state: 'running', pid }
      })
    } else {
      setRunningPid(profile.id, null)
    }
  }
}

export function startServer(profile: ServerProfile): ServerStatus {
  if (running.has(profile.id)) {
    return running.get(profile.id)!.status
  }

  const exe = getExecutablePath(profile)
  const args = buildLaunchArgs(profile)

  emitStatus({ profileId: profile.id, state: 'starting', startedAt: Date.now() })

  let child: ChildProcess
  try {
    // stdio: 'ignore' - ARK's dedicated server allocates its own console on
    // Windows rather than writing through the standard stdout handle, so
    // piping it never sees anything; the startup-complete marker is instead
    // read from the server's own log file (see watchLogFileForMarker).
    // detached + unref - the server must keep running even if this Manager
    // crashes or is closed; without detaching, Windows ties child processes to
    // the parent's job object and kills them the moment the parent dies.
    child = spawn(exe, args, { cwd: profile.installDir, stdio: 'ignore', detached: true })
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
  const status: ServerStatus = {
    profileId: profile.id,
    state: 'starting',
    pid,
    startedAt: Date.now()
  }
  running.set(profile.id, { process: child, pid, status })
  setRunningPid(profile.id, pid)
  emitStatus(status)

  const fallback = setTimeout(() => markReady(), STARTUP_FALLBACK_MS)
  const stopWatchingLog = watchLogFileForMarker(profile.installDir, STARTUP_COMPLETE_MARKER, () => markReady())

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
    finalizeStopped(profile.id)
  })

  child.on('error', (err) => {
    clearTimeout(fallback)
    stopWatchingLog()
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

/**
 * Graceful shutdown: SaveWorld, wait for its RCON confirmation, then DoExit.
 * DoExit is only sent once SaveWorld is confirmed - if RCON is unreachable or
 * the save fails, there is no safe orderly path, so we skip straight to the
 * grace-period/kill fallback instead of exiting on an unconfirmed save.
 */
export async function stopServer(
  profile: ServerProfile,
  graceMs = 15000,
  transientState: 'stopping' | 'restarting' = 'stopping'
): Promise<ServerStatus> {
  const entry = running.get(profile.id)
  if (!entry) return { profileId: profile.id, state: 'stopped' }

  emitStatus({ ...entry.status, state: transientState })

  const saveResult = await sendRconCommand(profile, 'SaveWorld')
  if (saveResult.ok) {
    await sendRconCommand(profile, 'DoExit')
  }

  await waitForExitOrKill(entry, profile.id, graceMs)
  return getStatus(profile.id)
}

export async function restartServer(profile: ServerProfile): Promise<ServerStatus> {
  await stopServer(profile, 15000, 'restarting')
  return startServer(profile)
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
