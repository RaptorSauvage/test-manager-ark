import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type { ServerProfile } from '../shared/types'

vi.mock('../src/main/lib/serverProcess', () => ({
  isRunning: vi.fn(() => true),
  startServer: vi.fn(),
  stopServer: vi.fn().mockResolvedValue(undefined)
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
import { isRunning as mockIsRunning, startServer as mockStartServer, stopServer as mockStopServer } from '../src/main/lib/serverProcess'
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
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
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

    expect(mockUpdateServer).toHaveBeenCalledWith(profile, '/tmp/steamcmd')
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

    expect(mockUpdateServer).toHaveBeenCalledWith(profile, '/tmp/steamcmd')
    expect(mockStartServer).toHaveBeenCalledWith(profile)
  })
})
