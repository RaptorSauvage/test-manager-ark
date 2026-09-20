import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ServerProfile } from '../shared/types'

vi.mock('../src/main/lib/serverProcess', () => ({
  isRunning: vi.fn(() => false)
}))
vi.mock('../src/main/lib/managerLog', () => ({
  logManagerEvent: vi.fn(),
  newTaskId: vi.fn((prefix: string) => `${prefix}-test`)
}))

import { handleStatusForCrashWatch, cancelPendingCrashRestart } from '../src/main/lib/crashWatch'
import { logManagerEvent as mockLogManagerEvent } from '../src/main/lib/managerLog'
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
    vi.mocked(mockLogManagerEvent).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('restarts 15s after a running server is confirmed stopped without ever going through stopping/restarting', () => {
    const profile = makeProfile({ id: 'crash-unexpected' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)
    expect(startServer).not.toHaveBeenCalled()

    vi.advanceTimersByTime(15000)

    expect(startServer).toHaveBeenCalledWith(profile)
  })

  it('logs a manager log entry when a crash is detected and again once the restart fires', () => {
    const profile = makeProfile({ id: 'crash-logged' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)

    expect(mockLogManagerEvent).toHaveBeenCalledWith(
      expect.stringContaining('crash-watch'),
      expect.stringContaining(profile.name),
      expect.stringContaining('Crash detected'),
      'error'
    )

    vi.advanceTimersByTime(15000)

    expect(mockLogManagerEvent).toHaveBeenCalledWith(
      expect.stringContaining('crash-watch'),
      expect.stringContaining(profile.name),
      'Restarting...'
    )
  })

  it('does not restart when the profile has the watchdog turned off', () => {
    const profile = makeProfile({ id: 'crash-disabled', crashWatchEnabled: false })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('ignores a deliberate stop (running -> stopping -> stopped)', () => {
    const profile = makeProfile({ id: 'crash-deliberate-stop' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopping' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('ignores a deliberate restart (running -> restarting -> stopped)', () => {
    const profile = makeProfile({ id: 'crash-deliberate-restart' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'restarting' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('never arms in the first place for a failure during startup - only a crash from a fully Started server counts', () => {
    // The server never got past 'starting' (e.g. it crashed before finishing startup) -
    // this is a startup failure, not "a running server that crashed", and retrying it
    // blindly every 15s would just loop forever on a fundamentally broken config.
    const profile = makeProfile({ id: 'crash-never-started' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'starting' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('re-checks the flag at fire time - disabling it during the wait cancels the restart', () => {
    const profile = makeProfile({ id: 'crash-disabled-during-wait' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)

    profile.crashWatchEnabled = false // e.g. the user turns it off during the 15s wait
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('cancels the pending restart if the server comes back some other way before the delay elapses', () => {
    const profile = makeProfile({ id: 'crash-recovered-early' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'starting' }, startServer, () => profile)

    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('does not fire twice for a repeated stopped tick', () => {
    const profile = makeProfile({ id: 'crash-repeated-stopped' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)

    vi.advanceTimersByTime(15000)

    expect(startServer).toHaveBeenCalledTimes(1)
  })

  it('skips the restart if the profile was deleted before the delay elapses', () => {
    const profile = makeProfile({ id: 'crash-deleted' })
    const startServer = vi.fn()
    let exists = true

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, startServer, () => (exists ? profile : undefined))
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => (exists ? profile : undefined))

    exists = false
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('skips the restart if the server is somehow already running again by fire time', () => {
    const profile = makeProfile({ id: 'crash-already-running-again' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)

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

    handleStatusForCrashWatch({ profileId: enabledProfile.id, state: 'running' }, startServer, lookup)
    handleStatusForCrashWatch({ profileId: disabledProfile.id, state: 'running' }, startServer, lookup)
    handleStatusForCrashWatch({ profileId: enabledProfile.id, state: 'stopped' }, startServer, lookup)
    handleStatusForCrashWatch({ profileId: disabledProfile.id, state: 'stopped' }, startServer, lookup)

    vi.advanceTimersByTime(15000)

    expect(startServer).toHaveBeenCalledTimes(1)
    expect(startServer).toHaveBeenCalledWith(enabledProfile)
  })

  it('does nothing for an unknown profile id', () => {
    const startServer = vi.fn()
    expect(() =>
      handleStatusForCrashWatch({ profileId: 'crash-unknown', state: 'stopped' }, startServer, () => undefined)
    ).not.toThrow()
    vi.advanceTimersByTime(15000)
    expect(startServer).not.toHaveBeenCalled()
  })

  it('cancelPendingCrashRestart stops an already-scheduled restart from ever firing (e.g. an explicit Kill)', () => {
    const profile = makeProfile({ id: 'crash-explicit-cancel' })
    const startServer = vi.fn()

    handleStatusForCrashWatch({ profileId: profile.id, state: 'running' }, startServer, () => profile)
    handleStatusForCrashWatch({ profileId: profile.id, state: 'stopped' }, startServer, () => profile)

    cancelPendingCrashRestart(profile.id)
    vi.advanceTimersByTime(15000)

    expect(startServer).not.toHaveBeenCalled()
  })

  it('cancelPendingCrashRestart is a harmless no-op when nothing is pending', () => {
    expect(() => cancelPendingCrashRestart('crash-nothing-pending')).not.toThrow()
  })
})
