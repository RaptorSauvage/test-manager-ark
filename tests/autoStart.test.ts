import { describe, expect, it, vi } from 'vitest'
import { runAutoStart } from '../src/main/lib/autoStart'
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

describe('runAutoStart', () => {
  it('does nothing when no profile has startOnManagerLaunch enabled', () => {
    const scheduleTimeout = vi.fn()
    const startProfile = vi.fn()
    runAutoStart([makeProfile(), makeProfile({ id: 'b' })], 10, () => false, startProfile, scheduleTimeout)
    expect(scheduleTimeout).not.toHaveBeenCalled()
  })

  it('skips profiles already running (adopted from a previous session)', () => {
    const scheduleTimeout = vi.fn((fn: () => void) => fn())
    const startProfile = vi.fn()
    const profiles = [makeProfile({ id: 'a', startOnManagerLaunch: true })]
    runAutoStart(profiles, 10, (id) => id === 'a', startProfile, scheduleTimeout)
    expect(startProfile).not.toHaveBeenCalled()
  })

  it('waits staggerSeconds before starting the first eligible profile too', () => {
    const scheduleTimeout = vi.fn()
    const startProfile = vi.fn()
    const profiles = [makeProfile({ id: 'a', startOnManagerLaunch: true })]
    runAutoStart(profiles, 10, () => false, startProfile, scheduleTimeout)
    expect(scheduleTimeout).toHaveBeenCalledTimes(1)
    expect(scheduleTimeout.mock.calls[0][1]).toBe(10000)
  })

  it('staggers every eligible profile by staggerSeconds each, including the first', () => {
    const scheduleTimeout = vi.fn()
    const startProfile = vi.fn()
    const profiles = [
      makeProfile({ id: 'a', startOnManagerLaunch: true }),
      makeProfile({ id: 'b', startOnManagerLaunch: true }),
      makeProfile({ id: 'c', startOnManagerLaunch: true })
    ]
    runAutoStart(profiles, 10, () => false, startProfile, scheduleTimeout)
    expect(scheduleTimeout.mock.calls.map((call) => call[1])).toEqual([10000, 20000, 30000])
  })

  it('ignores profiles with startOnManagerLaunch disabled when staggering the rest', () => {
    const scheduleTimeout = vi.fn()
    const startProfile = vi.fn()
    const profiles = [
      makeProfile({ id: 'a', startOnManagerLaunch: true }),
      makeProfile({ id: 'b', startOnManagerLaunch: false }),
      makeProfile({ id: 'c', startOnManagerLaunch: true })
    ]
    runAutoStart(profiles, 10, () => false, startProfile, scheduleTimeout)
    expect(scheduleTimeout.mock.calls.map((call) => call[1])).toEqual([10000, 20000])
  })

  it('actually invokes startProfile with the right profile once its delay fires', () => {
    const scheduleTimeout = vi.fn((fn: () => void) => fn())
    const startProfile = vi.fn()
    const profile = makeProfile({ id: 'a', startOnManagerLaunch: true })
    runAutoStart([profile], 10, () => false, startProfile, scheduleTimeout)
    expect(startProfile).toHaveBeenCalledWith(profile)
  })

  it('logs and continues if startProfile throws for one profile', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const scheduleTimeout = vi.fn((fn: () => void) => fn())
    const startProfile = vi.fn(() => {
      throw new Error('boom')
    })
    const profiles = [makeProfile({ id: 'a', startOnManagerLaunch: true })]
    expect(() => runAutoStart(profiles, 10, () => false, startProfile, scheduleTimeout)).not.toThrow()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('treats a negative stagger as zero delay for every profile', () => {
    const scheduleTimeout = vi.fn()
    const startProfile = vi.fn()
    const profiles = [
      makeProfile({ id: 'a', startOnManagerLaunch: true }),
      makeProfile({ id: 'b', startOnManagerLaunch: true })
    ]
    runAutoStart(profiles, -5, () => false, startProfile, scheduleTimeout)
    expect(scheduleTimeout.mock.calls.map((call) => call[1])).toEqual([0, 0])
  })
})
