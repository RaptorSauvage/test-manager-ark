import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ServerProfile } from '../shared/types'

vi.mock('../src/main/lib/backup', () => ({
  createBackup: vi.fn(async () => ({ fileName: 'x.zip', filePath: '/x.zip', createdAt: 0, sizeBytes: 0 })),
  logBackup: vi.fn()
}))

vi.mock('../src/main/lib/serverProcess', () => ({
  isRunning: vi.fn(() => false)
}))

import { applyBackupSchedule, clearBackupSchedule, getBackupScheduleStatus } from '../src/main/lib/schedule'
import { createBackup as mockCreateBackup, logBackup as mockLogBackup } from '../src/main/lib/backup'
import { isRunning as mockIsRunning } from '../src/main/lib/serverProcess'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'gate-test',
    name: 'Test',
    installDir: '/tmp/ark',
    map: 'TheIsland_WP',
    moddedMapEnabled: false,
    moddedMapId: '',
    gamePort: 7777,
    rconPort: 27020,
    serverPlatform: 'PC',
    maxPlayers: 70,
    backupDir: '/tmp/backups',
    maxBackups: 10,
    backupScheduleEnabled: true,
    backupSchedule: '0 */1 * * *',
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
    group: '',
    ...overrides
  }
}

describe('scheduled backup - only runs while the server is online', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:15:00Z'))
    vi.mocked(mockCreateBackup).mockClear()
    vi.mocked(mockLogBackup).mockClear()
    vi.mocked(mockIsRunning).mockReset().mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips (and logs why) without calling createBackup when the server is not running', () => {
    const profile = makeProfile()
    applyBackupSchedule(profile)

    vi.advanceTimersToNextTimer()

    expect(mockCreateBackup).not.toHaveBeenCalled()
    expect(mockLogBackup).toHaveBeenCalledWith(profile.id, expect.stringContaining('not running'))

    clearBackupSchedule(profile.id)
  })

  it('calls createBackup when the server is running', () => {
    vi.mocked(mockIsRunning).mockReturnValue(true)
    const profile = makeProfile()
    applyBackupSchedule(profile)

    vi.advanceTimersToNextTimer()

    expect(mockCreateBackup).toHaveBeenCalledWith(profile)

    clearBackupSchedule(profile.id)
  })

  it('re-arms for the next tick after firing, instead of dying after one run', () => {
    const profile = makeProfile()
    applyBackupSchedule(profile)

    const firstStatus = getBackupScheduleStatus(profile)
    expect(firstStatus.active).toBe(true)
    expect(firstStatus.nextRunAt).not.toBeNull()

    vi.advanceTimersToNextTimer()

    const secondStatus = getBackupScheduleStatus(profile)
    expect(secondStatus.active).toBe(true)
    expect(secondStatus.nextRunAt).not.toBeNull()
    expect(secondStatus.nextRunAt!).toBeGreaterThan(firstStatus.nextRunAt!)

    clearBackupSchedule(profile.id)
  })
})
