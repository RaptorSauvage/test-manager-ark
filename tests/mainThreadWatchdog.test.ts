import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const logManagerEventMock = vi.fn()
vi.mock('../src/main/lib/managerLog', () => ({
  logManagerEvent: (...args: unknown[]) => logManagerEventMock(...args),
  newTaskId: (prefix: string) => `${prefix}-test`
}))

import { startMainThreadWatchdog } from '../src/main/lib/mainThreadWatchdog'

// The watchdog's whole point is to notice a block it never saw coming, after the fact - these
// tests simulate that by moving Date.now() far ahead of where the fake timer clock itself sits
// right when the interval callback runs, exactly like a real block (the OS just doesn't
// schedule this process again for a while) would: the timer callback still only fires "on
// schedule" from the scheduler's own point of view, but Date.now() inside it reports real wall-
// clock time having jumped much further than that.
describe('mainThreadWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    logManagerEventMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('logs nothing for a normal, on-schedule tick', () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    startMainThreadWatchdog()
    now += 200
    vi.advanceTimersByTime(200)

    expect(logManagerEventMock).not.toHaveBeenCalled()
  })

  it('logs a Manager Log entry once a tick arrives much later than expected', () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    startMainThreadWatchdog()
    now += 2500 // simulates the main process having been blocked for ~2.5s
    vi.advanceTimersByTime(200)

    expect(logManagerEventMock).toHaveBeenCalledTimes(1)
    expect(logManagerEventMock).toHaveBeenCalledWith('perf-watchdog-test', 'Performance', expect.stringContaining('2.5s'), 'error')
  })

  it('logs again for a second, separate block later on', () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    startMainThreadWatchdog()
    now += 2500
    vi.advanceTimersByTime(200)
    now += 200
    vi.advanceTimersByTime(200)
    now += 3000
    vi.advanceTimersByTime(200)

    expect(logManagerEventMock).toHaveBeenCalledTimes(2)
  })
})
