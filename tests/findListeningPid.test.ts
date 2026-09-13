import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ServerProfile } from '../shared/types'

class FakeChildProcess extends EventEmitter {
  pid = 4242
  unref = vi.fn()
  kill = vi.fn(() => {
    this.emit('exit')
  })
}

const { getFakeChild, setFakeChild } = vi.hoisted(() => {
  let current: FakeChildProcess | undefined
  return {
    getFakeChild: () => current,
    setFakeChild: (child: FakeChildProcess) => {
      current = child
    }
  }
})

// findListeningPid only shells out to netstat on Windows - pin the platform here so this
// file can exercise that branch, independent of whatever OS actually runs the test suite.
vi.mock('node:process', () => ({ platform: 'win32' }))

const mockExec = vi.fn()
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => getFakeChild()),
  exec: (...args: unknown[]) => mockExec(...args)
}))

vi.mock('../src/main/lib/rcon', () => ({ sendRconCommand: vi.fn(async () => ({ ok: true, response: 'x' })) }))

import {
  startServer,
  isRunning,
  isPidTracked,
  getStatus,
  emitStatus,
  findListeningPid,
  handleUnexpectedExit
} from '../src/main/lib/serverProcess'
import { sendRconCommand as mockSendRconCommand } from '../src/main/lib/rcon'

/** Queues netstat -ano's callback-style exec to succeed with the given stdout. */
function mockNetstatOutput(stdout: string): void {
  mockExec.mockImplementation((_cmd: string, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) =>
    cb(null, { stdout, stderr: '' })
  )
}

function mockNetstatFailure(err: Error): void {
  mockExec.mockImplementation((_cmd: string, cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void) =>
    cb(err)
  )
}

function makeProfile(id: string, rconPort: number): ServerProfile {
  return {
    id,
    name: `Profile ${id}`,
    installDir: '/tmp/ark-pid-rediscovery-test',
    map: 'TheIsland_WP',
    moddedMapEnabled: false,
    moddedMapId: '',
    gamePort: 7777,
    rconPort,
    serverPlatform: 'PC',
    maxPlayers: 70,
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
    disableBattlEye: false,
    rconTribeLog: false,
    forceRespawnDinos: false,
    noSound: false,
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
    zombieDetectionAutoRestart: false
  }
}

beforeEach(() => {
  setFakeChild(new FakeChildProcess())
  mockExec.mockReset()
  vi.mocked(mockSendRconCommand).mockReset()
})

describe('findListeningPid', () => {
  it('extracts the pid from the LISTENING line matching the requested port', async () => {
    mockNetstatOutput(
      [
        '',
        'Active Connections',
        '',
        '  Proto  Local Address          Foreign Address        State           PID',
        '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       900',
        '  TCP    0.0.0.0:27020          0.0.0.0:0              LISTENING       55123',
        '  TCP    0.0.0.0:27020          10.0.0.5:51500         ESTABLISHED     55123',
        ''
      ].join('\r\n')
    )

    await expect(findListeningPid(27020)).resolves.toBe(55123)
  })

  it('resolves null when nothing is listening on that port', async () => {
    mockNetstatOutput(
      '  Proto  Local Address          Foreign Address        State           PID\r\n' +
        '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       900\r\n'
    )

    await expect(findListeningPid(27020)).resolves.toBeNull()
  })

  it('resolves null (rather than throwing) when netstat itself fails', async () => {
    mockNetstatFailure(new Error('netstat: command not found'))

    await expect(findListeningPid(27020)).resolves.toBeNull()
  })

  it('ignores a non-LISTENING match on the same port', async () => {
    mockNetstatOutput(
      '  Proto  Local Address          Foreign Address        State           PID\r\n' +
        '  TCP    0.0.0.0:27020          10.0.0.5:51500         ESTABLISHED     55123\r\n'
    )

    await expect(findListeningPid(27020)).resolves.toBeNull()
  })

  it('still finds it on a non-English Windows install, where the State column is localized', async () => {
    // French Windows prints "ÉCOUTE" instead of "LISTENING" - matching on the foreign
    // address placeholder (0.0.0.0:0) rather than that text is what makes this work
    // regardless of system language.
    mockNetstatOutput(
      '  Proto  Adresse locale         Adresse distante       État            PID\r\n' +
        '  TCP    0.0.0.0:27020          0.0.0.0:0              ÉCOUTE          55123\r\n'
    )

    await expect(findListeningPid(27020)).resolves.toBe(55123)
  })

  it('recognizes the IPv6 listening placeholder too', async () => {
    mockNetstatOutput(
      '  Proto  Local Address          Foreign Address        State           PID\r\n' +
        '  TCP    [::]:27020             [::]:0                 LISTENING       55123\r\n'
    )

    await expect(findListeningPid(27020)).resolves.toBe(55123)
  })
})

describe('handleUnexpectedExit - Windows pid rediscovery', () => {
  it('re-attaches full pid tracking to the process now holding the RCON port', async () => {
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })
    const profile = makeProfile('handoff-rediscover', 27020)
    mockNetstatOutput(
      `  Proto  Local Address          Foreign Address        State           PID\r\n` +
        `  TCP    0.0.0.0:27020          0.0.0.0:0              LISTENING       ${process.pid}\r\n`
    )

    startServer(profile)
    emitStatus({ ...getStatus(profile.id), state: 'running' })

    await handleUnexpectedExit(profile)

    expect(isRunning(profile.id)).toBe(true)
    expect(isPidTracked(profile.id)).toBe(true)
    expect(getStatus(profile.id)).toMatchObject({ state: 'running', pid: process.pid })
  })

  it('falls back to degraded (pid-untracked) mode when no listening pid can be found', async () => {
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })
    const profile = makeProfile('handoff-rediscover-fails', 27021)
    mockNetstatOutput('  Proto  Local Address          Foreign Address        State           PID\r\n')

    startServer(profile)
    emitStatus({ ...getStatus(profile.id), state: 'running' })

    await handleUnexpectedExit(profile)

    expect(isRunning(profile.id)).toBe(true)
    expect(isPidTracked(profile.id)).toBe(false)
  })
})
