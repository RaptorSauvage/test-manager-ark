import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { platform } from 'node:process'
import type { ServerProfile } from '../shared/types'

class FakeChildProcess extends EventEmitter {
  pid = 4242
  unref = vi.fn()
  kill = vi.fn()
}

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn(() => new FakeChildProcess()) }))
vi.mock('node:child_process', () => ({ spawn: spawnMock, exec: vi.fn() }))

import { startServer, getExecutablePath, __resetServerSpawnQueueForTests } from '../src/main/lib/serverProcess'

beforeEach(() => {
  __resetServerSpawnQueueForTests()
})

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'cwd-test',
    name: 'CWD Test',
    game: 'ark-evolved',
    installDir: platform === 'win32' ? 'A:\\Serveur\\ASE\\ASE Servers Data\\Gen2' : '/srv/ase/gen2',
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
    clusterLogArchiveMaxSizeMB: 10,
    ...overrides
  }
}

describe('startServer spawn options', () => {
  it("spawns with cwd set to the executable's own directory, not the install root", () => {
    spawnMock.mockClear()
    const profile = makeProfile()
    startServer(profile)

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [, , options] = spawnMock.mock.calls[0]
    const exe = getExecutablePath(profile)
    expect(options.cwd).toBe(path.dirname(exe))
    expect(options.cwd).not.toBe(profile.installDir)
  })

  it('spawns with windowsVerbatimArguments (a harmless no-op for a direct-spawned profile, kept for parity)', () => {
    spawnMock.mockClear()
    startServer(makeProfile({ id: 'verbatim-test' }))

    const [, , options] = spawnMock.mock.calls[0]
    expect(options.windowsVerbatimArguments).toBe(true)
  })
})
