import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ServerProfile } from '../shared/types'

vi.mock('pidusage', () => ({ default: vi.fn(async () => ({ cpu: 12.34, memory: 512 * 1024 * 1024 })) }))
vi.mock('../src/main/lib/rcon', () => ({ listPlayers: vi.fn(async () => ['Alice', 'Bob']) }))

import { adoptPersistedProcesses, emitStatus, getStatus } from '../src/main/lib/serverProcess'
import { startMonitoring, stopMonitoring } from '../src/main/lib/monitor'

function makeProfile(id: string): ServerProfile {
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
    hidden: false,
    group: ''
  }
}

describe('emitStatus persists into getStatus', () => {
  it('updates what getStatus returns, not just a live event', () => {
    const profile = makeProfile('persist-basic')
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })

    emitStatus({ profileId: profile.id, state: 'running', pid: process.pid, cpu: 7.5, memoryMB: 321, players: ['X'] })

    expect(getStatus(profile.id)).toMatchObject({ cpu: 7.5, memoryMB: 321, players: ['X'] })
  })
})

describe('monitor tick', () => {
  const profile = makeProfile('persist-monitor')

  beforeEach(() => {
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })
  })

  afterEach(() => {
    stopMonitoring(profile.id)
  })

  it('persists CPU/memory/players so a later getStatus() call (e.g. the web dashboard API) sees them too', async () => {
    startMonitoring(profile, 10)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const status = getStatus(profile.id)
    expect(status.cpu).toBe(12.3)
    expect(status.memoryMB).toBe(512)
    expect(status.players).toEqual(['Alice', 'Bob'])
  })
})
