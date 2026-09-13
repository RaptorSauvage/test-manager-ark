import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ServerProfile } from '../shared/types'

vi.mock('../src/main/lib/serverProcess', () => ({
  isRunning: vi.fn(() => false)
}))

import { handleStatusForCrashWatch } from '../src/main/lib/crashWatch'
import { isRunning as mockIsRunning } from '../src/main/lib/serverProcess'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'crash-test',
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
    crashWatchEnabled: true,
    ...overrides
  }
}

// handleStatusForCrashWatch is edge-triggered off its own module-level "last known state"
// map, keyed by profile id and never reset between tests - each test below uses its own id
// so an earlier test's transitions can't make a later one's first call look like a no-op
// repeat, or leave a pending timer that fires into a later test.
describe('handleStatusForCrashWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(mockIsRunning).mockReset().mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('restarts 15s after a running server is confirmed stopped without ever going through stopping/restarting', () => {
    const profile = makeProfile({ id: 'crash-unexpected' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, () => profile, startServer)
    expect(startServer).not.toHaveBeenCalled()

    vi.advanceTimersByTime(15000)

    expect(startServer).toHaveBeenCalledWith(profile)
  })

  it('does not restart when the profile has the watchdog turned off', () => {
    const profile = makeProfile({ id: 'crash-disabled', crashWatchEnabled: false })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, () => profile, startServer)
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('ignores a deliberate stop (running -> stopping -> stopped)', () => {
    const profile = makeProfile({ id: 'crash-deliberate-stop' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopping' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, () => profile, startServer)
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('ignores a deliberate restart (running -> restarting -> stopped)', () => {
    const profile = makeProfile({ id: 'crash-deliberate-restart' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'restarting' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, () => profile, startServer)
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('re-checks the flag at fire time - disabling it during the wait cancels the restart', () => {
    const profile = makeProfile({ id: 'crash-disabled-during-wait' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, () => profile, startServer)

    profile.crashWatchEnabled = false // e.g. the user turns it off during the 15s wait
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('cancels the pending restart if the server comes back some other way before the delay elapses', () => {
    const profile = makeProfile({ id: 'crash-recovered-early' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'starting' }, () => profile, startServer)

    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('does not fire twice for a repeated stopped tick', () => {
    const profile = makeProfile({ id: 'crash-repeated-stopped' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, () => profile, startServer)

    vi.advanceTimersByTime(15000)

    expect(startServer).toHaveBeenCalledTimes(1)
  })

  it('skips the restart if the profile was deleted before the delay elapses', () => {
    const profile = makeProfile({ id: 'crash-deleted' })
    const startServer = vi.fn()
    let exists = true

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, () => (exists ? profile : undefined), startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, () => (exists ? profile : undefined), startServer)

    exists = false
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('skips the restart if the server is somehow already running again by fire time', () => {
    const profile = makeProfile({ id: 'crash-already-running-again' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, () => profile, startServer)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, () => profile, startServer)

    vi.mocked(mockIsRunning).mockReturnValue(true)
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('treats each profile independently - one crashing does not affect another', () => {
    const enabledProfile = makeProfile({ id: 'crash-indep-enabled', crashWatchEnabled: true })
    const disabledProfile = makeProfile({ id: 'crash-indep-disabled', crashWatchEnabled: false })
    const lookup = (id: string): ServerProfile | undefined =>
      id === enabledProfile.id ? enabledProfile : id === disabledProfile.id ? disabledProfile : undefined
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: enabledProfile.id, state: 'running' }, lookup, startServer)
    handleStatusForCrashWatch({ profileId: disabledProfile.id, state: 'running' }, lookup, startServer)
    handleStatusForCrashWatch({ profileId: enabledProfile.id, state: 'stopped' }, lookup, startServer)
    handleStatusForCrashWatch({ profileId: disabledProfile.id, state: 'stopped' }, lookup, startServer)

    vi.advanceTimersByTime(15000)

    expect(startServer).toHaveBeenCalledTimes(1)
    expect(startServer).toHaveBeenCalledWith(enabledProfile)
  })

  it('does nothing for an unknown profile id', () => {
    const startServer = vi.fn()
    expect(() =>
      handleStatusForCrashWatch({ profileId: 'crash-unknown', state: 'stopped' }, () => undefined, startServer)
    ).not.toThrow()
    vi.advanceTimersByTime(15000)
    expect(startServer).not.toHaveBeenCalled()
  })
})
