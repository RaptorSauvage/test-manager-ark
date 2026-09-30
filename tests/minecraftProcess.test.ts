import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MinecraftProfile } from '@shared/minecraft'
import {
  startServer,
  stopServer,
  killServer,
  getStatus,
  getConsoleBacklog,
  sendStdinCommand,
  minecraftServerEvents
} from '../src/main/lib/minecraftProcess'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Waits (polling) until `check()` is true, or throws once `timeoutMs` elapses - `startServer`
 *  transitions from 'starting' to 'running' asynchronously (once the fake server below prints
 *  its own "Done (...)!" line), so tests can't just assert state synchronously after calling it. */
async function waitUntil(check: () => boolean, timeoutMs = 5000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await wait(stepMs)
  }
  if (!check()) throw new Error('waitUntil: condition never became true')
}

/** A tiny stand-in for a real Minecraft server process: prints Minecraft's own "ready" log
 *  line after a short delay, echoes every stdin line it receives (prefixed) so a sent command
 *  is observable in the console backlog, and exits cleanly on "stop". Runs under plain `node`,
 *  invoked via a shell wrapper script so this also exercises minecraftProcess.ts's
 *  launchMode: 'script' path exactly the way a real installed server would be launched. */
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
      setTimeout(() => process.exit(0), 20)
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
    fs.writeFileSync(scriptPath, `#!/bin/sh\nexec node "${path.join(tmpDir, 'fakeServer.js')}"\n`)
    fs.chmodSync(scriptPath, 0o755)

    profile = {
      id: `mc-test-${Math.random().toString(36).slice(2)}`,
      name: 'Test Minecraft Server',
      installDir: tmpDir,
      launchMode: 'script',
      jarFileName: '',
      scriptFileName: 'run.sh',
      minMemoryMB: 1024,
      maxMemoryMB: 2048,
      extraJvmArgs: '',
      extraProgramArgs: '',
      hidden: false,
      group: '',
      startOnManagerLaunch: false
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
    expect(started.pid).toBeGreaterThan(0)

    await waitUntil(() => getStatus(profile.id).state === 'running')

    const backlog = getConsoleBacklog(profile.id)
    expect(backlog.some((l) => l.text.includes('Starting minecraft server'))).toBe(true)
    expect(backlog.some((l) => l.text.includes('Done (1.234s)! For help, type "help"'))).toBe(true)

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

    await waitUntil(() => getConsoleBacklog(profile.id).some((l) => l.text === 'echo:say hello'))

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
    expect(getConsoleBacklog(profile.id).some((l) => l.text === 'Stopping the server')).toBe(true)
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
