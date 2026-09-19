import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ServerProfile } from '../shared/types'

vi.mock('pidusage', () => ({ default: vi.fn(async () => ({ cpu: 12.34, memory: 512 * 1024 * 1024 })) }))
vi.mock('../src/main/lib/rcon', () => ({ listPlayers: vi.fn(async () => ['Alice', 'Bob']) }))
vi.mock('../src/main/lib/statsHistory', () => ({ recordStatSample: vi.fn() }))

import { adoptPersistedProcesses } from '../src/main/lib/serverProcess'
import { startMonitoring, stopMonitoring } from '../src/main/lib/monitor'
import { recordStatSample as mockRecordStatSample } from '../src/main/lib/statsHistory'

function makeProfile(id: string, overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id,
    name: `Profile ${id}`,
    installDir: '/tmp/ark',
    map: 'TheIsland_WP',
    moddedMapEnabled: false,
    moddedMapId: '',
    gamePort: 7777,
    rconPort: 27020,
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
    zombieDetectionAutoRestart: false,
    clusterLogArchiveMaxSizeMB: 10,
    statsEnabled: false,
    ...overrides
  }
}

describe('monitor tick - stats history recording', () => {
  beforeEach(() => {
    vi.mocked(mockRecordStatSample).mockClear()
  })

  it('records a sample on a successful tick when statsEnabled is on', async () => {
    const profile = makeProfile('stats-enabled', { statsEnabled: true })
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })
    startMonitoring(profile, 10)

    await new Promise((resolve) => setTimeout(resolve, 50))
    stopMonitoring(profile.id)

    expect(mockRecordStatSample).toHaveBeenCalled()
    const [profileId, sample] = vi.mocked(mockRecordStatSample).mock.calls[0]
    expect(profileId).toBe(profile.id)
    expect(sample).toMatchObject({ cpu: 12.3, memoryMB: 512, players: 2 })
    expect(typeof sample.time).toBe('number')
  })

  it('never records a sample when statsEnabled is off', async () => {
    const profile = makeProfile('stats-disabled', { statsEnabled: false })
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })
    startMonitoring(profile, 10)

    await new Promise((resolve) => setTimeout(resolve, 50))
    stopMonitoring(profile.id)

    expect(mockRecordStatSample).not.toHaveBeenCalled()
  })
})
