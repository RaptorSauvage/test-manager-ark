import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ServerProfile } from '../shared/types'

const { getScheduledCallback, setScheduledCallback } = vi.hoisted(() => {
  let cb: (() => void) | null = null
  return {
    getScheduledCallback: (): (() => void) | null => cb,
    setScheduledCallback: (fn: () => void) => {
      cb = fn
    }
  }
})

vi.mock('node-cron', () => ({
  default: {
    validate: () => true,
    schedule: (_expr: string, fn: () => void) => {
      setScheduledCallback(fn)
      return { stop: vi.fn() }
    }
  }
}))

vi.mock('../src/main/lib/backup', () => ({
  createBackup: vi.fn(async () => ({ fileName: 'x.zip', filePath: '/x.zip', createdAt: 0, sizeBytes: 0 })),
  logBackup: vi.fn()
}))

vi.mock('../src/main/lib/serverProcess', () => ({
  isRunning: vi.fn(() => false)
}))

import { applyBackupSchedule, clearBackupSchedule } from '../src/main/lib/schedule'
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
    vi.mocked(mockCreateBackup).mockClear()
    vi.mocked(mockLogBackup).mockClear()
    vi.mocked(mockIsRunning).mockReset().mockReturnValue(false)
  })

  it('skips (and logs why) without calling createBackup when the server is not running', () => {
    const profile = makeProfile()
    applyBackupSchedule(profile)

    getScheduledCallback()?.()

    expect(mockCreateBackup).not.toHaveBeenCalled()
    expect(mockLogBackup).toHaveBeenCalledWith(profile.id, expect.stringContaining('not running'))

    clearBackupSchedule(profile.id)
  })

  it('calls createBackup when the server is running', () => {
    vi.mocked(mockIsRunning).mockReturnValue(true)
    const profile = makeProfile()
    applyBackupSchedule(profile)

    getScheduledCallback()?.()

    expect(mockCreateBackup).toHaveBeenCalledWith(profile)

    clearBackupSchedule(profile.id)
  })
})
