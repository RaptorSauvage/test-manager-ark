import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MinecraftProfile } from '@shared/minecraft'

// Regression test for a real report: stopping a Windows launchMode 'script' Minecraft server
// (modded Forge in particular) left the Manager stuck showing "Stopping" forever even though
// the actual server had already fully exited. Root cause: on Windows, a 'script' launch runs
// through a cmd.exe wrapper (entry.process) that spawns the real java process as its own
// child rather than replacing itself - some servers' generated run.bat ends in a `pause` (or
// similar) that blocks forever on a piped, non-interactive stdin once java has already exited,
// since nothing is ever there to supply the keystroke it's waiting for. minecraftProcess.ts's
// stop/kill logic used to finalize "stopped" only from entry.process's own 'exit' event, which
// never fired in that case - see waitForExitOrKill's own comment for the fix.
//
// findListeningPid is Windows-only, so platform is pinned here (independent of whatever OS
// actually runs the suite) the same way tests/findListeningPid.test.ts pins it for
// serverProcess.ts's own equivalent handoff logic.
vi.mock('node:process', () => ({ platform: 'win32' }))

const WRAPPER_PID = 11111
const REAL_PID = 22222

class FakeWrapperChild extends EventEmitter {
  pid = WRAPPER_PID
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin: { writable: boolean; write: (data: string) => void }

  constructor(onStdinWrite: (data: string) => void) {
    super()
    this.stdin = { writable: true, write: onStdinWrite }
  }
}

const { getOnStdinWrite, setOnStdinWrite } = vi.hoisted(() => {
  let current: (data: string) => void = () => {}
  return {
    getOnStdinWrite: () => current,
    setOnStdinWrite: (fn: (data: string) => void) => {
      current = fn
    }
  }
})

let fakeChild: FakeWrapperChild

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    fakeChild = new FakeWrapperChild((data: string) => getOnStdinWrite()(data))
    return fakeChild
  })
}))

let realPidAlive = true
let wrapperPidAlive = true

vi.mock('../src/main/lib/serverProcess', () => ({
  findListeningPid: vi.fn(async () => REAL_PID),
  isPidAlive: vi.fn((pid: number) => (pid === REAL_PID ? realPidAlive : pid === WRAPPER_PID ? wrapperPidAlive : false))
}))

vi.mock('../src/main/lib/minecraftRcon', () => ({
  sendMinecraftRconCommand: vi.fn(async () => ({ ok: false, error: 'not used in this test' }))
}))

const { mockDataDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path')
  return { mockDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'minecraft-process-win-datadir-')) }
})
vi.mock('../src/main/lib/dataDir', () => ({ getDataDir: () => mockDataDir }))

import { startServer, stopServer, killServer, getStatus, minecraftServerEvents } from '../src/main/lib/minecraftProcess'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntil(check: () => boolean, timeoutMs = 8000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await wait(stepMs)
  }
  if (!check()) throw new Error('waitUntil: condition never became true')
}

function makeProfile(id: string, tmpDir: string): MinecraftProfile {
  return {
    id,
    name: 'Windows Forge Test Server',
    serverType: 'forge',
    installDir: tmpDir,
    minecraftVersion: '1.20.1',
    launchMode: 'script',
    jarFileName: '',
    scriptFileName: 'run.bat',
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
    installedMods: []
  }
}

describe('minecraftProcess - Windows launchMode "script" wrapper hangs after the real server exits', () => {
  let tmpDir: string
  let profile: MinecraftProfile
  let killSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-process-win-test-'))
    profile = makeProfile(`mc-win-test-${Math.random().toString(36).slice(2)}`, tmpDir)
    realPidAlive = true
    wrapperPidAlive = true
    setOnStdinWrite(() => {})

    killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      if (pid === WRAPPER_PID) {
        wrapperPidAlive = false
        fakeChild.emit('exit', 0, null)
      } else if (pid === REAL_PID) {
        realPidAlive = false
      }
      return true
    }) as typeof process.kill)

    startServer(profile)
    // watchForScriptPidHandoff polls every 2s - wait for it to pick up the fake "real" java
    // pid from the mocked findListeningPid before the test proceeds.
    await waitUntil(() => getStatus(profile.id).pid === REAL_PID, 5000)
  })

  afterEach(() => {
    killSpy.mockRestore()
    minecraftServerEvents.removeAllListeners()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('stopServer still reports "stopped" once the real java pid exits, even though the cmd.exe wrapper hangs (e.g. on a trailing `pause`) and never emits its own exit event', async () => {
    // Simulates "stop" reaching java (via the wrapper's stdin) and it exiting cleanly, while
    // the wrapper itself never does - exactly a run.bat that hangs on a trailing `pause` once
    // piped stdio has nothing left to feed it.
    setOnStdinWrite((data: string) => {
      if (data.trim() === 'stop') {
        setTimeout(() => {
          realPidAlive = false
        }, 150)
      }
    })

    const status = await stopServer(profile, 5000)

    expect(status.state).toBe('stopped')
    // The hung wrapper is force-killed directly once the real pid is confirmed gone, rather
    // than being left running forever in the background.
    expect(killSpy).toHaveBeenCalledWith(WRAPPER_PID)
  }, 10000)

  it('killServer force-kills both the real java pid and the hung cmd.exe wrapper directly, not just whichever pid happens to be tracked', async () => {
    killServer(profile.id)

    await waitUntil(() => getStatus(profile.id).state === 'stopped', 2000)

    expect(killSpy).toHaveBeenCalledWith(REAL_PID)
    expect(killSpy).toHaveBeenCalledWith(WRAPPER_PID)
  }, 10000)
})
