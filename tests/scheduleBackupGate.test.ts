import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ServerProfile } from '../shared/types'

vi.mock('../src/main/lib/backup', () => ({
  createBackup: vi.fn(async () => ({ fileName: 'x.zip', filePath: '/x.zip', createdAt: 0, sizeBytes: 0 })),
  logBackup: vi.fn()
}))

vi.mock('../src/main/lib/serverProcess', () => ({
  isRunning: vi.fn(() => false)
}))

import {
  applyBackupSchedule,
  clearBackupSchedule,
  getBackupScheduleStatus,
  handleStatusForBackupSchedule
} from '../src/main/lib/schedule'
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
    startOnManagerLaunch: false,
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

  it('does not even arm the schedule while the server is stopped', () => {
    const profile = makeProfile()
    applyBackupSchedule(profile)

    expect(getBackupScheduleStatus(profile)).toEqual({ active: false, nextRunAt: null })
  })

  it('skips (and logs why) without calling createBackup, and drops the armed entry instead of re-arming, if the server stops in the narrow race between arming and firing', () => {
    vi.mocked(mockIsRunning).mockReturnValue(true) // running when armed
    const profile = makeProfile()
    applyBackupSchedule(profile)

    vi.mocked(mockIsRunning).mockReturnValue(false) // stops before the scheduled tick fires
    vi.advanceTimersToNextTimer()

    expect(mockCreateBackup).not.toHaveBeenCalled()
    expect(mockLogBackup).toHaveBeenCalledWith(profile.id, expect.stringContaining('not running'))
    expect(getBackupScheduleStatus(profile)).toEqual({ active: false, nextRunAt: null })

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
    vi.mocked(mockIsRunning).mockReturnValue(true)
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

describe('handleStatusForBackupSchedule - the task turns on and off with the server itself', () => {
  // handleStatusForBackupSchedule is edge-triggered off its own module-level "last known
  // state" map, keyed by profile id and never reset between tests - each test below uses
  // its own id so an earlier test's transitions can't make a later one's first call look
  // like a no-op repeat.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:15:00Z'))
    vi.mocked(mockIsRunning).mockReset().mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('arms the schedule the moment the server transitions to running', () => {
    const profile = makeProfile({ id: 'gate-watch-arm' })
    expect(getBackupScheduleStatus(profile)).toEqual({ active: false, nextRunAt: null })

    vi.mocked(mockIsRunning).mockReturnValue(true)
    handleStatusForBackupSchedule({ profileId: profile.id, state: 'running' }, () => profile)

    expect(getBackupScheduleStatus(profile).active).toBe(true)
    clearBackupSchedule(profile.id)
  })

  it('clears the schedule the moment the server stops running', () => {
    vi.mocked(mockIsRunning).mockReturnValue(true)
    const profile = makeProfile({ id: 'gate-watch-clear' })
    applyBackupSchedule(profile)
    expect(getBackupScheduleStatus(profile).active).toBe(true)

    vi.mocked(mockIsRunning).mockReturnValue(false)
    handleStatusForBackupSchedule({ profileId: profile.id, state: 'stopped' }, () => profile)

    expect(getBackupScheduleStatus(profile)).toEqual({ active: false, nextRunAt: null })
  })

  it('ignores a repeated status tick for the same state instead of re-arming on every poll', () => {
    vi.mocked(mockIsRunning).mockReturnValue(true)
    const profile = makeProfile({ id: 'gate-watch-repeat' })
    handleStatusForBackupSchedule({ profileId: profile.id, state: 'running' }, () => profile)
    const firstStatus = getBackupScheduleStatus(profile)

    handleStatusForBackupSchedule({ profileId: profile.id, state: 'running' }, () => profile)
    const secondStatus = getBackupScheduleStatus(profile)

    expect(secondStatus).toEqual(firstStatus)
    clearBackupSchedule(profile.id)
  })

  it('does nothing for an unknown profile id', () => {
    expect(() =>
      handleStatusForBackupSchedule({ profileId: 'gate-watch-unknown', state: 'running' }, () => undefined)
    ).not.toThrow()
  })
})
