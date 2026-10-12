import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ServerProfile } from '../shared/types'

class FakeChildProcess extends EventEmitter {
  pid = 4242
  unref = vi.fn()
  kill = vi.fn(() => {
    this.emit('exit')
  })
}

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn(() => new FakeChildProcess()) }))
vi.mock('node:child_process', () => ({ spawn: spawnMock, exec: vi.fn() }))

const mockSettings = { serverAutoStartStaggerSeconds: 10, showServerConsoleWindow: false }
vi.mock('../src/main/store', () => ({
  getSettings: () => mockSettings,
  setRunningPid: vi.fn(),
  setRunningStartedAt: vi.fn()
}))

import {
  startServer,
  stopServerPhased,
  killServer,
  getStatus,
  isRunning,
  __resetServerSpawnQueueForTests
} from '../src/main/lib/serverProcess'

function makeProfile(id: string): ServerProfile {
  return {
    id,
    name: `Profile ${id}`,
    game: 'ark-ascended',
    installDir: '/srv/ase/stagger-test',
    map: 'TheIsland_WP',
    moddedMapEnabled: false,
    moddedMapId: '',
    gamePort: 7777,
    rconPort: 27020,
    queryPort: 27015,
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
    maxDinoLevel: '',
    serverPassword: '',
    autoManageMods: false,
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
    clusterLogArchiveMaxSizeMB: 10
  }
}

describe('startServer spawn staggering', () => {
  beforeEach(() => {
    spawnMock.mockClear()
    mockSettings.serverAutoStartStaggerSeconds = 10
    __resetServerSpawnQueueForTests()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns the first of several close-together starts immediately', () => {
    const a = makeProfile('stagger-a')
    startServer(a)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(getStatus(a.id).pid).toBe(4242)
  })

  it('delays a second start requested right after the first until the stagger elapses', () => {
    const a = makeProfile('stagger-a2')
    const b = makeProfile('stagger-b2')

    startServer(a)
    expect(spawnMock).toHaveBeenCalledTimes(1)

    startServer(b)
    // Still queued - not spawned yet, but already reported as 'starting' rather than
    // 'stopped', so the UI doesn't flicker back to looking idle while it waits its turn.
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(getStatus(b.id).state).toBe('starting')
    expect(isRunning(b.id)).toBe(true)

    vi.advanceTimersByTime(9999)
    expect(spawnMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('stacks a third start a further stagger interval behind the second, not the first', () => {
    const a = makeProfile('stagger-a3')
    const b = makeProfile('stagger-b3')
    const c = makeProfile('stagger-c3')

    startServer(a)
    startServer(b)
    startServer(c)
    expect(spawnMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10000)
    expect(spawnMock).toHaveBeenCalledTimes(2) // b

    vi.advanceTimersByTime(9999)
    expect(spawnMock).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(1)
    expect(spawnMock).toHaveBeenCalledTimes(3) // c
  })

  it('does not delay a start that comes well after the previous one', () => {
    const a = makeProfile('stagger-a4')
    const b = makeProfile('stagger-b4')

    startServer(a)
    vi.advanceTimersByTime(60000) // long past the 10s stagger

    startServer(b)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('stopping a still-queued start cancels it outright without ever spawning', async () => {
    const a = makeProfile('stagger-a5')
    const b = makeProfile('stagger-b5')

    startServer(a)
    startServer(b)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(getStatus(b.id).state).toBe('starting')

    const { saved, finished } = stopServerPhased(b)
    expect(await saved).toBe(false)
    expect(await finished).toEqual({ profileId: b.id, state: 'stopped' })
    expect(getStatus(b.id)).toEqual({ profileId: b.id, state: 'stopped' })

    // Never spawned, and advancing past the stagger window confirms it doesn't spawn later.
    vi.advanceTimersByTime(60000)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('killing a still-queued start cancels it outright without ever spawning', () => {
    const a = makeProfile('stagger-a6')
    const b = makeProfile('stagger-b6')

    startServer(a)
    startServer(b)
    expect(spawnMock).toHaveBeenCalledTimes(1)

    const status = killServer(b.id)
    expect(status).toEqual({ profileId: b.id, state: 'stopped' })
    expect(isRunning(b.id)).toBe(false)

    vi.advanceTimersByTime(60000)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })
})
