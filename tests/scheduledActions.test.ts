import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type { ServerProfile } from '../shared/types'

// A real Set-backed isUpdating/setUpdating, mirroring serverProcess.ts's own semantics -
// needed so this file can assert on the *interaction* between the scheduled restart's grace
// delay and the isUpdating lock doStartServer (serverActions.ts) actually checks, not just
// that setUpdating got called with some arguments.
const { updatingProfiles } = vi.hoisted(() => ({ updatingProfiles: new Set<string>() }))
vi.mock('../src/main/lib/serverProcess', () => ({
  isRunning: vi.fn(() => true),
  startServer: vi.fn(),
  stopServer: vi.fn().mockResolvedValue(undefined),
  setUpdating: vi.fn((profileId: string, value: boolean) => {
    if (value) updatingProfiles.add(profileId)
    else updatingProfiles.delete(profileId)
  }),
  isUpdating: vi.fn((profileId: string) => updatingProfiles.has(profileId))
}))
vi.mock('../src/main/lib/monitor', () => ({ startMonitoring: vi.fn() }))
vi.mock('../src/main/lib/steamcmd', () => ({
  updateServer: vi.fn().mockResolvedValue(undefined),
  getUpdateLogPath: vi.fn(() => '/tmp/scheduled-actions-test-update.log')
}))
vi.mock('../src/main/lib/rcon', () => ({ sendRconCommand: vi.fn() }))
vi.mock('../src/main/store', () => ({ getSettings: vi.fn(() => ({ steamCmdPath: '/tmp/steamcmd' })) }))
vi.mock('node:fs', () => ({ default: { mkdirSync: vi.fn(), appendFileSync: vi.fn() } }))

import { runScheduledRestart } from '../src/main/lib/scheduledActions'
import { doStartServer } from '../src/main/lib/serverActions'
import {
  isRunning as mockIsRunning,
  startServer as mockStartServer,
  stopServer as mockStopServer,
  isUpdating as mockIsUpdating
} from '../src/main/lib/serverProcess'
import { updateServer as mockUpdateServer } from '../src/main/lib/steamcmd'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'scheduled-test',
    name: 'ScheduledTest',
    installDir: '/tmp/ark',
    scheduledRestartEnabled: true,
    scheduledRestartTime: '04:00',
    scheduledRestartDays: [],
    scheduledRestartUpdateAfter: false,
    scheduledRestartStartAfter: false,
    ...overrides
  } as ServerProfile
}

describe('runScheduledRestart', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(mockIsRunning).mockReturnValue(true)
    updatingProfiles.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    updatingProfiles.clear()
  })

  it('does nothing if the server is not actually running', async () => {
    vi.mocked(mockIsRunning).mockReturnValue(false)
    const profile = makeProfile({ scheduledRestartUpdateAfter: true, scheduledRestartStartAfter: true })

    await runScheduledRestart(profile)

    expect(mockStopServer).not.toHaveBeenCalled()
    expect(mockUpdateServer).not.toHaveBeenCalled()
    expect(mockStartServer).not.toHaveBeenCalled()
  })

  it('waits 10s after the server stops before starting the update', async () => {
    const profile = makeProfile({ scheduledRestartUpdateAfter: true })
    const run = runScheduledRestart(profile)

    await vi.waitFor(() => expect(mockStopServer).toHaveBeenCalledWith(profile))
    expect(mockUpdateServer).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(9999)
    expect(mockUpdateServer).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await run

    expect(mockUpdateServer).toHaveBeenCalledWith(profile, '/tmp/steamcmd', { skipInProgressGuard: true })
  })

  it('does not wait at all when no update is configured after the stop', async () => {
    const profile = makeProfile({ scheduledRestartUpdateAfter: false, scheduledRestartStartAfter: true })

    await runScheduledRestart(profile)

    expect(mockStopServer).toHaveBeenCalledWith(profile)
    expect(mockUpdateServer).not.toHaveBeenCalled()
    expect(mockStartServer).toHaveBeenCalledWith(profile)
  })

  it('starts the server again only after the delayed update finishes', async () => {
    const profile = makeProfile({ scheduledRestartUpdateAfter: true, scheduledRestartStartAfter: true })
    const run = runScheduledRestart(profile)

    await vi.waitFor(() => expect(mockStopServer).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(10000)
    await run

    expect(mockUpdateServer).toHaveBeenCalledWith(profile, '/tmp/steamcmd', { skipInProgressGuard: true })
    expect(mockStartServer).toHaveBeenCalledWith(profile)
  })

  it('blocks a manual start (doStartServer) for the whole 10s grace delay, not just while SteamCMD runs', async () => {
    const profile = makeProfile({ scheduledRestartUpdateAfter: true })
    const run = runScheduledRestart(profile)

    await vi.waitFor(() => expect(mockStopServer).toHaveBeenCalled())
    // Still inside the 10s grace delay, well before updateServer itself is even called.
    expect(mockUpdateServer).not.toHaveBeenCalled()
    expect(() => doStartServer(profile)).toThrow('Cannot start the server while an update is in progress.')

    await vi.advanceTimersByTimeAsync(9000)
    expect(() => doStartServer(profile)).toThrow('Cannot start the server while an update is in progress.')

    await vi.advanceTimersByTimeAsync(1000)
    await run

    // Released once the whole sequence (delay + update) is done.
    expect(mockIsUpdating(profile.id)).toBe(false)
    expect(() => doStartServer(profile)).not.toThrow()
  })

  it('releases the lock even when the update itself throws', async () => {
    vi.mocked(mockUpdateServer).mockRejectedValueOnce(new Error('SteamCMD not found'))
    const profile = makeProfile({ scheduledRestartUpdateAfter: true })
    const run = runScheduledRestart(profile)

    await vi.waitFor(() => expect(mockStopServer).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(10000)
    await run

    expect(mockIsUpdating(profile.id)).toBe(false)
    expect(() => doStartServer(profile)).not.toThrow()
  })

  it('never locks out manual start when no update is scheduled after the stop', async () => {
    const profile = makeProfile({ scheduledRestartUpdateAfter: false })

    await runScheduledRestart(profile)

    expect(() => doStartServer(profile)).not.toThrow()
  })
})
