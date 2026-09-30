import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { platform } from 'node:process'
import type { MinecraftProfile, MinecraftServerStatus, MinecraftConsoleLine } from '@shared/minecraft'

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
  process: ChildProcess
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

function buildJavaArgs(profile: MinecraftProfile): string[] {
  const args = [`-Xms${profile.minMemoryMB}M`, `-Xmx${profile.maxMemoryMB}M`]
  if (profile.extraJvmArgs.trim()) args.push(...profile.extraJvmArgs.trim().split(/\s+/))
  args.push('-jar', profile.jarFileName)
  if (profile.extraProgramArgs.trim()) args.push(...profile.extraProgramArgs.trim().split(/\s+/))
  return args
}

export function startServer(profile: MinecraftProfile): MinecraftServerStatus {
  const existing = running.get(profile.id)
  if (existing) return existing.status

  emitStatus({ profileId: profile.id, state: 'starting', startedAt: Date.now() })

  let child: ChildProcess
  try {
    if (profile.launchMode === 'script') {
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
  const status: MinecraftServerStatus = { profileId: profile.id, state: 'starting', pid, startedAt }
  running.set(profile.id, { process: child, status })
  consoleBacklogs.set(profile.id, [])
  emitStatus(status)

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
    running.delete(profile.id)
    emitStatus({
      profileId: profile.id,
      state: 'stopped',
      ...(code !== 0 && code !== null ? { lastError: `Process exited with code ${code}${signal ? ` (signal ${signal})` : ''}` } : {})
    })
  })

  child.on('error', (err) => {
    running.delete(profile.id)
    emitStatus({ profileId: profile.id, state: 'error', lastError: err.message })
  })

  return status
}

/** Sends a line of input straight to the running process's stdin - the primary way to send
 *  a server command, since Minecraft/Java server processes reliably support piped stdio
 *  (unlike ARK's dedicated server on Windows, which is why ARK is RCON/log-file-only).
 *  Works whether or not RCON is enabled in server.properties. minecraftRcon.ts's
 *  sendMinecraftRconCommand is the secondary path, for player-list queries or a server this
 *  Manager didn't itself spawn (no live stdin handle in that case - not yet possible given
 *  the MVP scope cut on cross-restart re-adoption, but the fallback exists for when it is). */
export function sendStdinCommand(profileId: string, command: string): boolean {
  const entry = running.get(profileId)
  if (!entry?.process.stdin?.writable) return false
  try {
    entry.process.stdin.write(command.endsWith('\n') ? command : `${command}\n`)
    return true
  } catch (err) {
    console.error(`Failed to write command to Minecraft profile ${profileId}'s stdin:`, (err as Error).message)
    return false
  }
}

async function waitForExitOrKill(entry: RunningMinecraftServer, graceMs: number): Promise<void> {
  const exited = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), graceMs)
    entry.process.once('exit', () => {
      clearTimeout(timeout)
      resolve(true)
    })
  })
  if (!exited) entry.process.kill()
}

/** Graceful shutdown: writes "stop" to the process's own stdin, which saves the world, kicks
 *  players, and exits on its own - there's no separate save-then-exit RCON handshake to phase
 *  this into the way ARK's stopServerPhased needs. Waits up to graceMs before force-killing. */
export async function stopServer(profile: MinecraftProfile, graceMs = STOP_GRACE_MS): Promise<MinecraftServerStatus> {
  const entry = running.get(profile.id)
  if (!entry) return { profileId: profile.id, state: 'stopped' }

  emitStatus({ ...entry.status, state: 'stopping' })
  if (!sendStdinCommand(profile.id, 'stop')) {
    console.error(`Could not write "stop" to ${profile.name}'s stdin - falling back to waiting then force-killing.`)
  }
  await waitForExitOrKill(entry, graceMs)
  return getStatus(profile.id)
}

/** Immediately force-kills the process - no graceful "stop" is sent, so any unsaved world
 *  state since the last autosave is lost. */
export function killServer(profileId: string): MinecraftServerStatus {
  const entry = running.get(profileId)
  if (!entry) return { profileId, state: 'stopped' }
  emitStatus({ ...entry.status, state: 'stopping' })
  entry.process.kill()
  return getStatus(profileId)
}
