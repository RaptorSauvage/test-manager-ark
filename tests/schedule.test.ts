import { describe, expect, it, afterEach, vi } from 'vitest'

// The schedule only ever arms while the server is running (see scheduleBackupGate.test.ts
// for that gating behavior in detail) - default it to running here so this file's own
// tests, which are about the arm/clear/status mechanics rather than run-state, don't all
// need their own override.
vi.mock('../src/main/lib/serverProcess', () => ({ isRunning: vi.fn(() => true) }))

import { applyBackupSchedule, clearBackupSchedule, getBackupScheduleStatus } from '../src/main/lib/schedule'
import { isRunning as mockIsRunning } from '../src/main/lib/serverProcess'
import type { ServerProfile } from '../shared/types'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'test',
    name: 'Test',
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
    ...overrides
  }
}

describe('getBackupScheduleStatus', () => {
  afterEach(() => {
    clearBackupSchedule('test')
  })

  it('reports inactive with no next run for a profile with no schedule applied', () => {
    expect(getBackupScheduleStatus(makeProfile())).toEqual({ active: false, nextRunAt: null })
  })

  it('reports active with a future next run once a valid schedule is applied', () => {
    const profile = makeProfile({ backupScheduleEnabled: true, backupSchedule: '0 */6 * * *' })
    applyBackupSchedule(profile)

    const status = getBackupScheduleStatus(profile)
    expect(status.active).toBe(true)
    expect(status.nextRunAt).not.toBeNull()
    expect(status.nextRunAt!).toBeGreaterThan(Date.now())
  })

  it('reports inactive again after the schedule is cleared', () => {
    const profile = makeProfile({ backupScheduleEnabled: true, backupSchedule: '0 */6 * * *' })
    applyBackupSchedule(profile)
    clearBackupSchedule(profile.id)

    expect(getBackupScheduleStatus(profile)).toEqual({ active: false, nextRunAt: null })
  })

  it('does not apply (and reports inactive for) an invalid cron expression', () => {
    const profile = makeProfile({ backupScheduleEnabled: true, backupSchedule: 'not a cron expression' })
    applyBackupSchedule(profile)

    expect(getBackupScheduleStatus(profile)).toEqual({ active: false, nextRunAt: null })
  })

  it('does not apply (and reports inactive for) a disabled schedule', () => {
    const profile = makeProfile({ backupScheduleEnabled: false, backupSchedule: '0 */6 * * *' })
    applyBackupSchedule(profile)

    expect(getBackupScheduleStatus(profile)).toEqual({ active: false, nextRunAt: null })
  })

  it('does not apply (and reports inactive for) a valid, enabled schedule while the server is stopped', () => {
    vi.mocked(mockIsRunning).mockReturnValueOnce(false)
    const profile = makeProfile({ backupScheduleEnabled: true, backupSchedule: '0 */6 * * *' })
    applyBackupSchedule(profile)

    expect(getBackupScheduleStatus(profile)).toEqual({ active: false, nextRunAt: null })
  })
})
