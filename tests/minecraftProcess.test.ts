import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MinecraftProfile, MinecraftServerStatus } from '@shared/minecraft'

// minecraftConsoleArchive.ts's file paths live under getDataDir(), which normally goes
// through Electron's app.getPath() - unavailable in this Node test environment. Point it at
// a real temp dir instead, same pattern as clusterLogArchive.test.ts.
const { mockDataDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path')
  return { mockDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'minecraft-process-datadir-')) }
})
vi.mock('../src/main/lib/dataDir', () => ({ getDataDir: () => mockDataDir }))

import {
  startServer,
  stopServer,
  killServer,
  getStatus,
  getConsoleBacklog,
  sendStdinCommand,
  minecraftServerEvents,
  adoptPersistedMinecraftProcesses,
  isRunning
} from '../src/main/lib/minecraftProcess'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Waits (polling) until `check()` is true, or throws once `timeoutMs` elapses - `startServer`
 *  transitions from 'starting' to 'running' asynchronously (once the fake server below prints
 *  its own "Done (...)!" line), so tests can't just assert state synchronously after calling it. */
async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs = 5000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await wait(stepMs)
  }
  if (!(await check())) throw new Error('waitUntil: condition never became true')
}

/** A tiny stand-in for a real Minecraft server process: prints Minecraft's own "ready" log
 *  line after a short delay, echoes every stdin line it receives (prefixed) so a sent command
 *  is observable in the console backlog, and exits on "stop"/"crash". Runs under plain `node`,
 *  invoked via a shell wrapper script so this also exercises minecraftProcess.ts's
 *  launchMode: 'script' path exactly the way a real installed server would be launched.
 *  "stop" deliberately exits with a *non-zero* code (1), not 0 - same as a real server can
 *  genuinely do on an otherwise perfectly normal shutdown (and exactly what a forcibly-killed
 *  Windows script-mode wrapper's own exit code looks like, even after a clean stop - see
 *  minecraftProcess.ts's own child.on('exit') comment) - so stopServer's own tests below can
 *  tell a deliberate stop's exit code apart from a genuine crash's. "crash" exits non-zero too,
 *  but without ever going through stopServer/killServer first (status stays 'running'), to
 *  prove the fix doesn't just unconditionally swallow every non-zero exit code. */
const FAKE_SERVER_JS = `
process.stdout.write('Starting minecraft server version 1.20.1\\n')
setTimeout(() => {
  process.stdout.write('Done (1.234s)! For help, type "help"\\n')
}, 50)
process.stdin.setEncoding('utf-8')
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split('\\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) {
    if (!line) continue
    if (line === 'stop') {
      process.stdout.write('Stopping the server\\n')
      setTimeout(() => process.exit(1), 20)
    } else if (line === 'crash') {
      process.exit(1)
    } else {
      process.stdout.write('echo:' + line + '\\n')
    }
  }
})
`

describe('minecraftProcess (spawned via launchMode "script")', () => {
  let tmpDir: string
  let profile: MinecraftProfile

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-process-test-'))
    fs.writeFileSync(path.join(tmpDir, 'fakeServer.js'), FAKE_SERVER_JS)
    const scriptPath = path.join(tmpDir, 'run.sh')
    // Same shape as modern Forge/NeoForge's own generated run.sh - reads user_jvm_args.txt,
    // which is what lets the Manager's own memory-writing tests below actually apply (see
    // scriptReadsUserJvmArgs in minecraftProcess.ts) - the fake server itself never reads
    // this, only the detection logic cares that the string is present in the script.
    fs.writeFileSync(
      scriptPath,
      `#!/bin/sh\n# @user_jvm_args.txt\nexec node "${path.join(tmpDir, 'fakeServer.js')}"\n`
    )
    fs.chmodSync(scriptPath, 0o755)

    profile = {
      id: `mc-test-${Math.random().toString(36).slice(2)}`,
      name: 'Test Minecraft Server',
      serverType: 'vanilla',
      installDir: tmpDir,
      minecraftVersion: '',
      launchMode: 'script',
      jarFileName: '',
      scriptFileName: 'run.sh',
      minMemoryMB: 1024,
      maxMemoryMB: 2048,
      extraJvmArgs: '',
      extraProgramArgs: '',
      hidden: false,
      group: '',
      startOnManagerLaunch: false,
      scheduledRestartEnabled: false,
      scheduledRestartTime: '00:00',
      scheduledRestartDays: [],
      scheduledRestartStartAfter: true,
      backupDir: '',
      maxBackups: 10,
      backupScheduleEnabled: false,
      installedMods: [],
      consoleLoggingEnabled: true
    }
  })

  afterEach(async () => {
    // Best-effort cleanup in case a test failed before its own stop/kill ran.
    if (getStatus(profile.id).state !== 'stopped') {
      killServer(profile.id)
      await wait(100)
    }
    minecraftServerEvents.removeAllListeners()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('goes starting -> running once the ready marker is seen, and captures console output', async () => {
    const started = startServer(profile)
    expect(started.state).toBe('starting')
    // pid isn't known synchronously any more - the actual spawn is deferred behind an async
    // memory-settings file check (see minecraftProcess.ts's doSpawn) so it never blocks the
    // Electron main process on Start. Settles moments later, once the real process exists.
    await waitUntil(() => (getStatus(profile.id).pid ?? 0) > 0)

    await waitUntil(() => getStatus(profile.id).state === 'running')

    const backlog = await getConsoleBacklog(profile.id)
    expect(backlog.some((l) => l.text.includes('Starting minecraft server'))).toBe(true)
    expect(backlog.some((l) => l.text.includes('Done (1.234s)! For help, type "help"'))).toBe(true)

    await stopServer(profile)
  })

  it('skips the archive write and live console feed entirely when consoleLoggingEnabled is false, but ready detection and stdin still work', async () => {
    // The actual escape hatch for a modpack chatty enough that even the capped, backgrounded
    // archive write is still real per-line overhead - everything else about the server
    // (starting, detecting it's ready, sending commands) must keep working regardless.
    profile.consoleLoggingEnabled = false
    startServer(profile)
    await waitUntil(() => getStatus(profile.id).state === 'running')

    expect(await getConsoleBacklog(profile.id)).toEqual([])
    expect(fs.existsSync(path.join(mockDataDir, 'logs', 'minecraft-console', `${profile.id}.jsonl`))).toBe(false)

    const sent = sendStdinCommand(profile.id, 'say hello')
    expect(sent).toBe(true)

    await stopServer(profile)
  })

  it('writes user_jvm_args.txt (Forge\'s own JVM-args mechanism) before a script-mode launch', async () => {
    profile.minMemoryMB = 1536
    profile.maxMemoryMB = 6144
    profile.extraJvmArgs = '-XX:+UseG1GC'
    startServer(profile)
    await waitUntil(() => getStatus(profile.id).state === 'running')

    const content = fs.readFileSync(path.join(tmpDir, 'user_jvm_args.txt'), 'utf-8')
    expect(content).toBe('-Xms1536M\n-Xmx6144M\n-XX:+UseG1GC\n')

    await stopServer(profile)
  })

  it('clamps min memory down to max instead of writing -Xms greater than -Xmx, which the JVM refuses to start on at all', async () => {
    // Easy to end up in by accident since both fields auto-save on every keystroke
    // (StartSettingsTab.tsx) - the real-world report was the server crash-looping forever
    // ("Initial heap size set to a larger value than the maximum heap size").
    profile.minMemoryMB = 6144
    profile.maxMemoryMB = 2048
    startServer(profile)
    await waitUntil(() => getStatus(profile.id).state === 'running')

    const content = fs.readFileSync(path.join(tmpDir, 'user_jvm_args.txt'), 'utf-8')
    expect(content).toBe('-Xms2048M\n-Xmx2048M\n')

    await stopServer(profile)
  })

  it('does not write user_jvm_args.txt for a script that never reads it, to avoid a second, conflicting source of memory settings', async () => {
    // A real report: a CurseForge-exported modpack's generated script sets its own -Xms/-Xmx
    // directly on the command line, with no @user_jvm_args.txt reference anywhere - writing
    // the file regardless risked exactly the "two sources of truth for memory" overlap that
    // was reported, for a script set up like that.
    const scriptPath = path.join(tmpDir, 'run.sh')
    fs.writeFileSync(scriptPath, `#!/bin/sh\nexec node "${path.join(tmpDir, 'fakeServer.js')}"\n`)
    fs.chmodSync(scriptPath, 0o755)

    startServer(profile)
    await waitUntil(() => getStatus(profile.id).state === 'running')

    expect(fs.existsSync(path.join(tmpDir, 'user_jvm_args.txt'))).toBe(false)

    await stopServer(profile)
  })

  it('writes memory to variables.txt\'s own JAVA_ARGS line for a ServerStarterJar-style pack (CurseForge/Overwolf export), instead of user_jvm_args.txt', async () => {
    // variables.txt's own documentation comment literally contains the string
    // "user_jvm_args.txt" (explaining that JAVA_ARGS also gets copied there for some
    // modloaders) - the real report was the Manager false-positive-detecting that mention as
    // "the script reads user_jvm_args.txt" and writing its own, independent memory settings
    // there on top of this file's JAVA_ARGS, creating two conflicting sources of truth.
    fs.writeFileSync(
      path.join(tmpDir, 'variables.txt'),
      [
        '###',
        "# JAVA_ARGS are arguments to pass to the JVM... also written to the 'user_jvm_args.txt' when using modloaders such as Forge.",
        '###',
        'MINECRAFT_VERSION=1.20.1',
        'MODLOADER=Fabric',
        'JAVA="java"',
        'JAVA_ARGS="-Xmx16G -Xms16G"',
        'RESTART=true',
        ''
      ].join('\n')
    )
    profile.minMemoryMB = 2048
    profile.maxMemoryMB = 4096
    profile.extraJvmArgs = '-XX:+UseG1GC'

    startServer(profile)
    await waitUntil(() => getStatus(profile.id).state === 'running')

    expect(fs.existsSync(path.join(tmpDir, 'user_jvm_args.txt'))).toBe(false)
    const content = fs.readFileSync(path.join(tmpDir, 'variables.txt'), 'utf-8')
    expect(content).toContain('JAVA_ARGS="-Xms2048M -Xmx4096M -XX:+UseG1GC"')
    // Everything else in the file is left exactly as it was.
    expect(content).toContain('MODLOADER=Fabric')
    expect(content).toContain('RESTART=true')

    await stopServer(profile)
  })

  it('does not return a second entry when starting an already-running profile', async () => {
    const first = startServer(profile)
    const second = startServer(profile)
    expect(second).toBe(first)
    await stopServer(profile)
  })

  it('writes commands to stdin and observes the echoed response in the console', async () => {
    startServer(profile)
    await waitUntil(() => getStatus(profile.id).state === 'running')

    const sent = sendStdinCommand(profile.id, 'say hello')
    expect(sent).toBe(true)

    await waitUntil(async () => (await getConsoleBacklog(profile.id)).some((l) => l.text === 'echo:say hello'))

    await stopServer(profile)
  })

  it('reports false when writing to a profile with no running process', () => {
    expect(sendStdinCommand('unknown-profile-id', 'say hi')).toBe(false)
  })

  it('stopServer writes "stop" to stdin and waits for a clean exit', async () => {
    startServer(profile)
    await waitUntil(() => getStatus(profile.id).state === 'running')

    const status = await stopServer(profile)
    expect(status.state).toBe('stopped')
    expect((await getConsoleBacklog(profile.id)).some((l) => l.text === 'Stopping the server')).toBe(true)
  })

  it('stopServer does not report a lastError even though the process itself exits with a non-zero code', async () => {
    // Regression test: a deliberate stop/kill already flipped the status to 'stopping' before
    // the process ever exits, so a non-zero exit code seen from that state is expected, not a
    // crash worth flagging in red on the server card - see the fake server's own stop handler
    // comment above for why its exit code is 1, not 0. Listens to the 'status' event directly
    // rather than getStatus() afterward - the 'stopped' bookkeeping (including its own
    // lastError, if any) is cleared from the running map by the time stopServer returns, same
    // as every other exit path here, so getStatus() post-hoc would always read back the bare
    // fallback regardless of what was actually broadcast.
    startServer(profile)
    await waitUntil(() => getStatus(profile.id).state === 'running')

    const statuses: MinecraftServerStatus[] = []
    minecraftServerEvents.on('status', (s: MinecraftServerStatus) => {
      if (s.profileId === profile.id) statuses.push(s)
    })

    const status = await stopServer(profile)
    expect(status.state).toBe('stopped')
    const stoppedEvent = statuses.find((s) => s.state === 'stopped')
    expect(stoppedEvent?.lastError).toBeUndefined()
  })

  it('an unexpected exit while still "running" (not through stopServer/killServer) still surfaces a lastError', async () => {
    // Proves the fix above doesn't just unconditionally swallow every non-zero exit code -
    // only one seen from a deliberate 'stopping' state is suppressed.
    startServer(profile)
    await waitUntil(() => getStatus(profile.id).state === 'running')

    const statuses: MinecraftServerStatus[] = []
    minecraftServerEvents.on('status', (s: MinecraftServerStatus) => {
      if (s.profileId === profile.id) statuses.push(s)
    })

    sendStdinCommand(profile.id, 'crash')
    await waitUntil(() => statuses.some((s) => s.state === 'stopped'))

    const stoppedEvent = statuses.find((s) => s.state === 'stopped')
    expect(stoppedEvent?.lastError).toMatch(/code 1/)
  })

  it('stopServer on an already-stopped profile is a no-op that reports stopped', async () => {
    const status = await stopServer(profile)
    expect(status).toEqual({ profileId: profile.id, state: 'stopped' })
  })

  it('killServer force-kills without waiting for a graceful stop', async () => {
    startServer(profile)
    await waitUntil(() => getStatus(profile.id).state === 'running')

    killServer(profile.id)
    await waitUntil(() => getStatus(profile.id).state === 'stopped')
  })
})

describe('adoptPersistedMinecraftProcesses (re-attaching after a Manager restart)', () => {
  let profile: MinecraftProfile
  let adoptedPid: number | undefined

  beforeEach(() => {
    profile = {
      id: `mc-adopt-test-${Math.random().toString(36).slice(2)}`,
      name: 'Adopted Server',
      serverType: 'vanilla',
      installDir: os.tmpdir(),
      minecraftVersion: '',
      launchMode: 'jar',
      jarFileName: 'server.jar',
      scriptFileName: '',
      minMemoryMB: 1024,
      maxMemoryMB: 2048,
      extraJvmArgs: '',
      extraProgramArgs: '',
      hidden: false,
      group: '',
      startOnManagerLaunch: false,
      scheduledRestartEnabled: false,
      scheduledRestartTime: '00:00',
      scheduledRestartDays: [],
      scheduledRestartStartAfter: true,
      backupDir: '',
      maxBackups: 10,
      backupScheduleEnabled: false,
      installedMods: [],
      consoleLoggingEnabled: true
    }
  })

  afterEach(async () => {
    if (adoptedPid !== undefined) {
      try {
        process.kill(adoptedPid)
      } catch {
        // Already gone.
      }
      adoptedPid = undefined
    }
    if (getStatus(profile.id).state !== 'stopped') {
      killServer(profile.id)
      await wait(100)
    }
  })

  it('adopts a still-alive persisted pid as running, with no live console', async () => {
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'])
    adoptedPid = child.pid!
    await wait(100)

    adoptPersistedMinecraftProcesses([profile], { [profile.id]: adoptedPid }, { [profile.id]: 12345 })

    expect(isRunning(profile.id)).toBe(true)
    const status = getStatus(profile.id)
    expect(status.state).toBe('running')
    expect(status.pid).toBe(adoptedPid)
    expect(status.startedAt).toBe(12345)
    expect(status.consoleAvailable).toBe(false)
    expect(await getConsoleBacklog(profile.id)).toEqual([])
  })

  it('does not adopt a pid that is no longer alive', () => {
    // A pid essentially guaranteed not to correspond to a live process right now.
    adoptPersistedMinecraftProcesses([profile], { [profile.id]: 999999 })
    expect(isRunning(profile.id)).toBe(false)
    expect(getStatus(profile.id).state).toBe('stopped')
  })

  it('sendStdinCommand returns false for an adopted process (no live stdin)', async () => {
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'])
    adoptedPid = child.pid!
    await wait(100)

    adoptPersistedMinecraftProcesses([profile], { [profile.id]: adoptedPid })
    expect(sendStdinCommand(profile.id, 'say hi')).toBe(false)
  })

  it('killServer terminates an adopted process and finalizes it as stopped, with no exit event needed', async () => {
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'])
    adoptedPid = child.pid!
    await wait(100)

    adoptPersistedMinecraftProcesses([profile], { [profile.id]: adoptedPid })
    expect(isRunning(profile.id)).toBe(true)

    killServer(profile.id)
    expect(getStatus(profile.id).state).toBe('stopped')
    expect(isRunning(profile.id)).toBe(false)

    await wait(100)
    expect(() => process.kill(adoptedPid!, 0)).toThrow()
    adoptedPid = undefined
  })
})
