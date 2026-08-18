import { describe, expect, it, vi } from 'vitest'
import type { ServerStatus } from '../shared/types'
import { handleStatusForVersionTracking } from '../src/main/lib/serverVersionWatcher'

function status(profileId: string, state: ServerStatus['state']): ServerStatus {
  return { profileId, state }
}

describe('handleStatusForVersionTracking', () => {
  it('reads and stores the version the first time a profile is seen running', () => {
    const lookupProfile = vi.fn().mockReturnValue({ installDir: '/servers/a' })
    const fetchVersion = vi.fn().mockResolvedValue('92.28')
    const storeVersion = vi.fn()

    handleStatusForVersionTracking(status('watch-a', 'running'), lookupProfile, fetchVersion, storeVersion)

    expect(lookupProfile).toHaveBeenCalledWith('watch-a')
    expect(fetchVersion).toHaveBeenCalledWith('/servers/a')
    return Promise.resolve().then(() => {
      expect(storeVersion).toHaveBeenCalledWith('watch-a', '92.28')
    })
  })

  it('does nothing for a non-running state', () => {
    const lookupProfile = vi.fn()
    const fetchVersion = vi.fn()
    const storeVersion = vi.fn()

    handleStatusForVersionTracking(status('watch-b', 'starting'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-b', 'stopped'), lookupProfile, fetchVersion, storeVersion)

    expect(lookupProfile).not.toHaveBeenCalled()
    expect(fetchVersion).not.toHaveBeenCalled()
  })

  it('does not re-read the log on a repeated running status (e.g. a monitor tick)', () => {
    const lookupProfile = vi.fn().mockReturnValue({ installDir: '/servers/c' })
    const fetchVersion = vi.fn().mockResolvedValue('92.28')
    const storeVersion = vi.fn()

    handleStatusForVersionTracking(status('watch-c', 'running'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-c', 'running'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-c', 'running'), lookupProfile, fetchVersion, storeVersion)

    expect(fetchVersion).toHaveBeenCalledTimes(1)
  })

  it('reads again on a fresh start after having stopped in between', () => {
    const lookupProfile = vi.fn().mockReturnValue({ installDir: '/servers/d' })
    const fetchVersion = vi.fn().mockResolvedValue('92.28')
    const storeVersion = vi.fn()

    handleStatusForVersionTracking(status('watch-d', 'running'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-d', 'stopping'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-d', 'stopped'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-d', 'starting'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-d', 'running'), lookupProfile, fetchVersion, storeVersion)

    expect(fetchVersion).toHaveBeenCalledTimes(2)
  })

  it('treats an unknown profile (deleted since) as a no-op, not an error', () => {
    const lookupProfile = vi.fn().mockReturnValue(undefined)
    const fetchVersion = vi.fn()
    const storeVersion = vi.fn()

    expect(() =>
      handleStatusForVersionTracking(status('watch-e', 'running'), lookupProfile, fetchVersion, storeVersion)
    ).not.toThrow()
    expect(fetchVersion).not.toHaveBeenCalled()
  })

  it('does not store anything when the log has no version line yet', async () => {
    const lookupProfile = vi.fn().mockReturnValue({ installDir: '/servers/f' })
    const fetchVersion = vi.fn().mockResolvedValue(null)
    const storeVersion = vi.fn()

    handleStatusForVersionTracking(status('watch-f', 'running'), lookupProfile, fetchVersion, storeVersion)
    await Promise.resolve()
    expect(storeVersion).not.toHaveBeenCalled()
  })
})
