import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { platform } from 'node:process'
import type { ServerProfile, ServerStatus } from '@shared/types'
import { sendRconCommand } from './rcon'
import { setRunningPid } from '../store'

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
export function buildLaunchArgs(profile: ServerProfile): string[] {
  const params = [
    'listen',
    `Port=${profile.gamePort}`,
    `QueryPort=${profile.queryPort}`,
    'RCONEnabled=True',
    `RCONPort=${profile.rconPort}`
  ]
  if (profile.rconPassword) params.push(`ServerAdminPassword=${profile.rconPassword}`)

  const args = [`${profile.map}?${params.join('?')}`, '-server', '-log']
  const enabledModIds = profile.mods
    .filter((mod) => mod.enabled)
    .map((mod) => (mod.dev ? `${mod.id}-dev` : mod.id))
  if (enabledModIds.length > 0) {
    args.push(`-mods=${enabledModIds.join(',')}`)
  }
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
    // stdio: 'ignore' - nothing in the app reads stdout/stderr, and leaving them
    // as unread pipes risks the OS pipe buffer filling up and stalling the server
    // once it logs enough; ARK's dedicated server shows its own console anyway.
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

  const status: ServerStatus = {
    profileId: profile.id,
    state: 'running',
    pid,
    startedAt: Date.now()
  }
  running.set(profile.id, { process: child, pid, status })
  setRunningPid(profile.id, pid)
  emitStatus(status)

  child.on('exit', () => finalizeStopped(profile.id))

  child.on('error', (err) => {
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
export async function stopServer(profile: ServerProfile, graceMs = 15000): Promise<ServerStatus> {
  const entry = running.get(profile.id)
  if (!entry) return { profileId: profile.id, state: 'stopped' }

  emitStatus({ ...entry.status, state: 'stopping' })

  const saveResult = await sendRconCommand(profile, 'SaveWorld')
  if (saveResult.ok) {
    await sendRconCommand(profile, 'DoExit')
  }

  await waitForExitOrKill(entry, profile.id, graceMs)
  return getStatus(profile.id)
}

export async function restartServer(profile: ServerProfile): Promise<ServerStatus> {
  await stopServer(profile)
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
