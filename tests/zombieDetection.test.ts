import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ServerProfile } from '../shared/types'

// vi.mock's factory is hoisted above every import (including 'node:events'), so the
// EventEmitter it needs is constructed via a dynamic import inside the factory itself
// instead of a module-level one - see https://vitest.dev/api/vi.html#vi-hoisted for why a
// plain top-level `new EventEmitter()` reference wouldn't survive the hoist.
const { mockGetStatus } = vi.hoisted(() => ({ mockGetStatus: vi.fn() }))

vi.mock('../src/main/lib/serverProcess', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    serverEvents: new EventEmitter(),
    getStatus: (id: string) => mockGetStatus(id)
  }
})

import { handleStatusForZombieDetection, cancelPendingZombieCheck } from '../src/main/lib/zombieDetection'
import { serverEvents as mockServerEvents } from '../src/main/lib/serverProcess'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'zombie-test',
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
    crashWatchEnabled: false,
    zombieDetectionEnabled: true,
    zombieDetectionTimeoutMinutes: 10,
    zombieDetectionAutoRestart: false,
    ...overrides
  }
}

// handleStatusForZombieDetection is edge-triggered off its own module-level "last known
// state" map, keyed by profile id and never reset between tests - each test below uses its
// own id so an earlier test's transitions can't make a later one's first call look like a
// no-op repeat, or leave a pending timer that fires into a later test.
describe('handleStatusForZombieDetection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockGetStatus.mockReset().mockImplementation((id: string) => ({ profileId: id, state: 'starting' }))
  })

  afterEach(() => {
    vi.useRealTimers()
    mockServerEvents.removeAllListeners()
  })

  it('kills the server after the default 10-minute timeout while stuck starting', () => {
    const profile = makeProfile({ id: 'zombie-basic' })
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)
    expect(killServer).not.toHaveBeenCalled()

    vi.advanceTimersByTime(10 * 60_000)

    expect(killServer).toHaveBeenCalledWith(profile.id)
    expect(startServer).not.toHaveBeenCalled()
  })

  it('does not arm when zombie detection is turned off for the profile', () => {
    const profile = makeProfile({ id: 'zombie-disabled', zombieDetectionEnabled: false })
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)
    vi.advanceTimersByTime(60 * 60_000)

    expect(killServer).not.toHaveBeenCalled()
  })

  it('cancels the check once the server reaches running before the timeout', () => {
    const profile = makeProfile({ id: 'zombie-resolved' })
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)
    handleStatusForZombieDetection({ profileId: profile.id, state: 'running' }, killServer, startServer, () => profile)

    vi.advanceTimersByTime(10 * 60_000)

    expect(killServer).not.toHaveBeenCalled()
  })

  it('respects a custom timeout value instead of always using 10 minutes', () => {
    const profile = makeProfile({ id: 'zombie-custom-timeout', zombieDetectionTimeoutMinutes: 3 })
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)

    vi.advanceTimersByTime(2 * 60_000)
    expect(killServer).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1 * 60_000)
    expect(killServer).toHaveBeenCalledTimes(1)
  })

  it('re-checks the flag at fire time - disabling it during the wait cancels the kill', () => {
    const profile = makeProfile({ id: 'zombie-disabled-during-wait' })
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)
    profile.zombieDetectionEnabled = false
    vi.advanceTimersByTime(10 * 60_000)

    expect(killServer).not.toHaveBeenCalled()
  })

  it('does not re-arm (or reset the clock) on a repeated starting tick for the same startup attempt', () => {
    const profile = makeProfile({ id: 'zombie-no-rearm' })
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)
    vi.advanceTimersByTime(5 * 60_000)
    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)
    vi.advanceTimersByTime(5 * 60_000) // 10 total minutes since the first, real arm

    expect(killServer).toHaveBeenCalledTimes(1)
  })

  it('kills then restarts once the kill is confirmed stopped, when auto-restart is enabled', async () => {
    const profile = makeProfile({ id: 'zombie-auto-restart', zombieDetectionAutoRestart: true })
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)
    vi.advanceTimersByTime(10 * 60_000)

    expect(killServer).toHaveBeenCalledWith(profile.id)
    expect(startServer).not.toHaveBeenCalled() // not yet - waiting for the confirmed stop

    mockServerEvents.emit('status', { profileId: profile.id, state: 'stopped' })
    await Promise.resolve()
    await Promise.resolve()

    expect(startServer).toHaveBeenCalledWith(profile)
  })

  it('does not restart if auto-restart gets disabled between the kill and the confirmed stop', async () => {
    const profile = makeProfile({ id: 'zombie-auto-restart-disabled-midway', zombieDetectionAutoRestart: true })
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)
    vi.advanceTimersByTime(10 * 60_000)

    profile.zombieDetectionAutoRestart = false
    mockServerEvents.emit('status', { profileId: profile.id, state: 'stopped' })
    await Promise.resolve()
    await Promise.resolve()

    expect(startServer).not.toHaveBeenCalled()
  })

  it('never restarts when auto-restart is off, even after the kill is confirmed stopped', async () => {
    const profile = makeProfile({ id: 'zombie-no-auto-restart', zombieDetectionAutoRestart: false })
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)
    vi.advanceTimersByTime(10 * 60_000)

    mockServerEvents.emit('status', { profileId: profile.id, state: 'stopped' })
    await Promise.resolve()
    await Promise.resolve()

    expect(startServer).not.toHaveBeenCalled()
  })

  it('skips the kill if the profile was deleted before the timeout elapses', () => {
    const profile = makeProfile({ id: 'zombie-deleted' })
    const killServer = vi.fn()
    const startServer = vi.fn()
    let exists = true

    handleStatusForZombieDetection(
      { profileId: profile.id, state: 'starting' },
      killServer,
      startServer,
      () => (exists ? profile : undefined)
    )
    exists = false
    vi.advanceTimersByTime(10 * 60_000)

    expect(killServer).not.toHaveBeenCalled()
  })

  it('does not kill if the state has already moved on by fire time, even without an explicit cancel', () => {
    // Belt-and-suspenders: normally leaving 'starting' cancels the timer outright (see the
    // "cancels the check once running" test above), but this proves the fire-time getStatus
    // check independently blocks a stale kill too, in case that cancellation is ever missed.
    const profile = makeProfile({ id: 'zombie-stale-fire' })
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)
    mockGetStatus.mockReturnValue({ profileId: profile.id, state: 'running' })
    vi.advanceTimersByTime(10 * 60_000)

    expect(killServer).not.toHaveBeenCalled()
  })

  it('treats each profile independently', () => {
    const enabledProfile = makeProfile({ id: 'zombie-indep-enabled' })
    const disabledProfile = makeProfile({ id: 'zombie-indep-disabled', zombieDetectionEnabled: false })
    const lookup = (id: string): ServerProfile | undefined =>
      id === enabledProfile.id ? enabledProfile : id === disabledProfile.id ? disabledProfile : undefined
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: enabledProfile.id, state: 'starting' }, killServer, startServer, lookup)
    handleStatusForZombieDetection({ profileId: disabledProfile.id, state: 'starting' }, killServer, startServer, lookup)

    vi.advanceTimersByTime(10 * 60_000)

    expect(killServer).toHaveBeenCalledTimes(1)
    expect(killServer).toHaveBeenCalledWith(enabledProfile.id)
  })

  it('does nothing for an unknown profile id', () => {
    const killServer = vi.fn()
    const startServer = vi.fn()
    expect(() =>
      handleStatusForZombieDetection({ profileId: 'zombie-unknown', state: 'starting' }, killServer, startServer, () => undefined)
    ).not.toThrow()
    vi.advanceTimersByTime(60 * 60_000)
    expect(killServer).not.toHaveBeenCalled()
  })

  it('cancelPendingZombieCheck stops an already-armed check from ever firing', () => {
    const profile = makeProfile({ id: 'zombie-explicit-cancel' })
    const killServer = vi.fn()
    const startServer = vi.fn()

    handleStatusForZombieDetection({ profileId: profile.id, state: 'starting' }, killServer, startServer, () => profile)
    cancelPendingZombieCheck(profile.id)
    vi.advanceTimersByTime(10 * 60_000)

    expect(killServer).not.toHaveBeenCalled()
  })

  it('cancelPendingZombieCheck is a harmless no-op when nothing is pending', () => {
    expect(() => cancelPendingZombieCheck('zombie-nothing-pending')).not.toThrow()
  })
})
