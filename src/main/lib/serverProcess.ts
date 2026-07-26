import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { platform } from 'node:process'
import type { ServerProfile, ServerStatus, ServerLogLine } from '@shared/types'
import { sendRconCommand } from './rcon'

interface RunningServer {
  process: ChildProcessWithoutNullStreams
  status: ServerStatus
}

const running = new Map<string, RunningServer>()

export const serverEvents = new EventEmitter()

function emitStatus(status: ServerStatus): void {
  const entry = running.get(status.profileId)
  if (entry) entry.status = status
  serverEvents.emit('status', status)
}

function emitLog(line: ServerLogLine): void {
  serverEvents.emit('log', line)
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
  if (profile.activeMods.length > 0) {
    args.push(`-mods=${profile.activeMods.join(',')}`)
  }
  if (profile.extraArgs.trim()) {
    args.push(...profile.extraArgs.trim().split(/\s+/))
  }
  return args
}

export function getStatus(profileId: string): ServerStatus {
  return running.get(profileId)?.status ?? { profileId, state: 'stopped' }
}

export function isRunning(profileId: string): boolean {
  return running.has(profileId)
}

export function startServer(profile: ServerProfile): ServerStatus {
  if (running.has(profile.id)) {
    return running.get(profile.id)!.status
  }

  const exe = getExecutablePath(profile)
  const args = buildLaunchArgs(profile)

  emitStatus({ profileId: profile.id, state: 'starting', startedAt: Date.now() })

  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(exe, args, { cwd: profile.installDir })
  } catch (err) {
    const failed: ServerStatus = { profileId: profile.id, state: 'error', lastError: (err as Error).message }
    emitStatus(failed)
    return failed
  }

  const status: ServerStatus = {
    profileId: profile.id,
    state: 'running',
    pid: child.pid,
    startedAt: Date.now()
  }
  running.set(profile.id, { process: child, status })
  emitStatus(status)
  emitLog({ profileId: profile.id, stream: 'system', line: `Started (pid ${child.pid})`, timestamp: Date.now() })

  child.stdout.on('data', (data: Buffer) => {
    for (const line of data.toString().split(/\r?\n/).filter(Boolean)) {
      emitLog({ profileId: profile.id, stream: 'stdout', line, timestamp: Date.now() })
    }
  })
  child.stderr.on('data', (data: Buffer) => {
    for (const line of data.toString().split(/\r?\n/).filter(Boolean)) {
      emitLog({ profileId: profile.id, stream: 'stderr', line, timestamp: Date.now() })
    }
  })

  child.on('exit', (code) => {
    running.delete(profile.id)
    emitStatus({ profileId: profile.id, state: 'stopped' })
    emitLog({
      profileId: profile.id,
      stream: 'system',
      line: `Process exited with code ${code}`,
      timestamp: Date.now()
    })
  })

  child.on('error', (err) => {
    emitStatus({ profileId: profile.id, state: 'error', lastError: err.message })
  })

  return status
}

export async function stopServer(profile: ServerProfile, graceMs = 15000): Promise<ServerStatus> {
  const entry = running.get(profile.id)
  if (!entry) return { profileId: profile.id, state: 'stopped' }

  emitStatus({ ...entry.status, state: 'stopping' })

  try {
    await sendRconCommand(profile, 'SaveWorld')
    await sendRconCommand(profile, 'DoExit')
  } catch {
    // RCON unreachable - fall through to a hard kill below
  }

  const exited = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), graceMs)
    entry.process.once('exit', () => {
      clearTimeout(timeout)
      resolve(true)
    })
  })

  if (!exited && running.has(profile.id)) {
    entry.process.kill()
  }

  return getStatus(profile.id)
}

export async function restartServer(profile: ServerProfile): Promise<ServerStatus> {
  await stopServer(profile)
  return startServer(profile)
}
