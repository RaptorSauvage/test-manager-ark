import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { ServerProfile } from '../shared/types'

// ARK: Survival Evolved launches through a .bat/cmd.exe only on Windows - pin the platform
// here so this file can exercise that branch, independent of whatever OS actually runs the
// test suite.
vi.mock('node:process', () => ({ platform: 'win32' }))

class FakeChildProcess extends EventEmitter {
  pid = 9001
  unref = vi.fn()
  kill = vi.fn()
}

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn(() => new FakeChildProcess()) }))
const mockExec = vi.fn()
vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  exec: (...args: unknown[]) => mockExec(...args)
}))

import { startServer, isPidTracked, getStatus } from '../src/main/lib/serverProcess'

function mockNetstatOutput(stdout: string): void {
  mockExec.mockImplementation((_cmd: string, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) =>
    cb(null, { stdout, stderr: '' })
  )
}

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'batch-launch-test',
    name: 'Batch Launch Test',
    game: 'ark-evolved',
    installDir: 'A:\\Serveur\\ASE\\ASE Servers Data\\Gen2',
    map: 'Gen2',
    moddedMapEnabled: false,
    moddedMapId: '',
    gamePort: 8004,
    rconPort: 8202,
    queryPort: 8102,
    serverPlatform: 'PC',
    maxPlayers: 10,
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    playerProfileBackupEnabled: false,
    playerProfileBackupMaxPerPlayer: 20,
    mods: [],
    clusterEnabled: false,
    clusterId: '',
    clusterDirOverride: '',
    noTransferFromFiltering: false,
    externalIp: '',
    cultureSettings: 'none',
    disableBattlEye: true,
    rconTribeLog: false,
    forceRespawnDinos: true,
    noSound: false,
    maxDinoLevel: '',
    sessionName: '[Genesis Part.II] Culte de Bober',
    serverPassword: 'bober',
    extraArgs: '',
    scheduledRestartEnabled: false,
    scheduledRestartTime: '00:00',
    scheduledRestartDays: [],
    scheduledRestartUpdateAfter: false,
    scheduledRestartStartAfter: false,
    scheduledDinoWipeEnabled: false,
    scheduledDinoWipeTime: '00:00',
    scheduledDinoWipeDays: [],
    startOnManagerLaunch: false,
    hidden: false,
    group: '',
    crashWatchEnabled: false,
    zombieDetectionEnabled: false,
    zombieDetectionTimeoutMinutes: 10,
    zombieDetectionAutoRestart: false,
    clusterLogArchiveMaxSizeMB: 10,
    ...overrides
  }
}

beforeEach(() => {
  spawnMock.mockClear()
  mockExec.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startServer - ARK: Survival Evolved batch launch (Windows)', () => {
  it('spawns cmd.exe /d /c <bat>, not the exe directly', () => {
    mockNetstatOutput('  Proto  Local Address          Foreign Address        State           PID\r\n')
    const profile = makeProfile()
    startServer(profile)

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args] = spawnMock.mock.calls[0]
    expect(command).toBe('cmd.exe')
    expect(args[0]).toBe('/d')
    expect(args[1]).toBe('/c')
    expect(typeof args[2]).toBe('string')
    expect(args[2]).toMatch(/ark-manager-launch-batch-launch-test\.bat$/)
  })

  it('writes a .bat whose command line matches the confirmed-working, unquoted shape', () => {
    mockNetstatOutput('  Proto  Local Address          Foreign Address        State           PID\r\n')
    const profile = makeProfile({ id: 'batch-launch-content-test' })
    startServer(profile)

    const batPath = spawnMock.mock.calls[0][1][2] as string
    const content = fs.readFileSync(batPath, 'utf-8')

    // path.join's separator depends on the OS actually running this test, not the mocked
    // platform - build the expected cd target the same way the code does rather than
    // hardcoding either style.
    const expectedDir = path.join(profile.installDir, 'ShooterGame', 'Binaries', 'Win64')
    expect(content).toContain(`cd /d "${expectedDir}"`)
    expect(content).toContain(
      'ShooterGameServer.exe Gen2?Port=8004?QueryPort=8102?RCONPort=8202?RCONEnabled=True?MaxPlayers=10' +
        '?SessionName=[Genesis Part.II] Culte de Bober?ServerPassword=bober -NoBattlEye -ForceRespawnDinos -servergamelog'
    )
    // Never quoted - a quoted SessionName is exactly what didn't work.
    expect(content).not.toContain('"Gen2?')
  })

  it('starts with pidTracked false (the tracked pid is cmd.exe, not the real server)', () => {
    mockNetstatOutput('  Proto  Local Address          Foreign Address        State           PID\r\n')
    const profile = makeProfile({ id: 'batch-launch-pidtracked-test' })
    startServer(profile)

    expect(isPidTracked(profile.id)).toBe(false)
    expect(getStatus(profile.id).pid).toBe(9001) // cmd.exe's pid, for now
  })

  it('hands off to the real listening pid once found, flipping pidTracked to true', async () => {
    const profile = makeProfile({ id: 'batch-launch-handoff-test' })
    mockNetstatOutput('  Proto  Local Address          Foreign Address        State           PID\r\n')
    startServer(profile)
    expect(isPidTracked(profile.id)).toBe(false)

    // isPidAlive checks a real OS-level pid (process.kill(pid, 0)) - use this test process's
    // own, genuinely-alive pid rather than a fabricated one, same trick
    // findListeningPid.test.ts's handoff tests use.
    mockNetstatOutput(
      '  Proto  Local Address          Foreign Address        State           PID\r\n' +
        `  TCP    0.0.0.0:8202            0.0.0.0:0              LISTENING       ${process.pid}\r\n`
    )

    await vi.advanceTimersByTimeAsync(2000)

    expect(isPidTracked(profile.id)).toBe(true)
    expect(getStatus(profile.id).pid).toBe(process.pid)
  })

  it('keeps polling (does not hand off) while nothing is listening yet', async () => {
    const profile = makeProfile({ id: 'batch-launch-no-handoff-test' })
    mockNetstatOutput('  Proto  Local Address          Foreign Address        State           PID\r\n')
    startServer(profile)

    await vi.advanceTimersByTimeAsync(2000)

    expect(isPidTracked(profile.id)).toBe(false)
    expect(getStatus(profile.id).pid).toBe(9001)
  })
})
