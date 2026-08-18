import { describe, expect, it, vi } from 'vitest'
import type { ServerProfile, ServerStatus } from '../shared/types'
import { handleStatusForVersionTracking, checkAllGameVersionsOnStartup } from '../src/main/lib/serverVersionWatcher'

function status(profileId: string, state: ServerStatus['state']): ServerStatus {
  return { profileId, state }
}

function profile(id: string, installDir: string): ServerProfile {
  return { id, installDir } as ServerProfile
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

  it('also checks on entering starting/stopping/updating/stopped, not just running', () => {
    const lookupProfile = vi.fn().mockReturnValue({ installDir: '/servers/b' })
    const fetchVersion = vi.fn().mockResolvedValue('92.28')
    const storeVersion = vi.fn()

    handleStatusForVersionTracking(status('watch-b', 'starting'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-b', 'running'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-b', 'stopping'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-b', 'stopped'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-b', 'updating'), lookupProfile, fetchVersion, storeVersion)

    expect(fetchVersion).toHaveBeenCalledTimes(5)
  })

  it('skips entering "error" - nothing about a failed start would have changed the log', () => {
    const lookupProfile = vi.fn().mockReturnValue({ installDir: '/servers/err' })
    const fetchVersion = vi.fn()
    const storeVersion = vi.fn()

    handleStatusForVersionTracking(status('watch-err', 'starting'), lookupProfile, fetchVersion, storeVersion)
    fetchVersion.mockClear()
    handleStatusForVersionTracking(status('watch-err', 'error'), lookupProfile, fetchVersion, storeVersion)

    expect(fetchVersion).not.toHaveBeenCalled()
  })

  it('does not re-read the log on a repeated status of the same state (e.g. a monitor tick)', () => {
    const lookupProfile = vi.fn().mockReturnValue({ installDir: '/servers/c' })
    const fetchVersion = vi.fn().mockResolvedValue('92.28')
    const storeVersion = vi.fn()

    handleStatusForVersionTracking(status('watch-c', 'running'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-c', 'running'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-c', 'running'), lookupProfile, fetchVersion, storeVersion)

    expect(fetchVersion).toHaveBeenCalledTimes(1)
  })

  it('checks again on each distinct transition through a full stop/start cycle', () => {
    const lookupProfile = vi.fn().mockReturnValue({ installDir: '/servers/d' })
    const fetchVersion = vi.fn().mockResolvedValue('92.28')
    const storeVersion = vi.fn()

    handleStatusForVersionTracking(status('watch-d', 'running'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-d', 'stopping'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-d', 'stopped'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-d', 'starting'), lookupProfile, fetchVersion, storeVersion)
    handleStatusForVersionTracking(status('watch-d', 'running'), lookupProfile, fetchVersion, storeVersion)

    expect(fetchVersion).toHaveBeenCalledTimes(5)
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

describe('checkAllGameVersionsOnStartup', () => {
  it('checks every profile, regardless of its running state', async () => {
    const profiles = [profile('p1', '/servers/1'), profile('p2', '/servers/2'), profile('p3', '/servers/3')]
    const fetchVersion = vi.fn().mockResolvedValue('92.28')
    const storeVersion = vi.fn()

    checkAllGameVersionsOnStartup(profiles, fetchVersion, storeVersion)
    await Promise.resolve()

    expect(fetchVersion).toHaveBeenCalledWith('/servers/1')
    expect(fetchVersion).toHaveBeenCalledWith('/servers/2')
    expect(fetchVersion).toHaveBeenCalledWith('/servers/3')
    expect(storeVersion).toHaveBeenCalledTimes(3)
  })

  it('stores nothing for a profile whose log has no version line', async () => {
    const fetchVersion = vi.fn().mockResolvedValue(null)
    const storeVersion = vi.fn()

    checkAllGameVersionsOnStartup([profile('p1', '/servers/1')], fetchVersion, storeVersion)
    await Promise.resolve()

    expect(storeVersion).not.toHaveBeenCalled()
  })

  it('does nothing for an empty profile list', () => {
    const fetchVersion = vi.fn()
    const storeVersion = vi.fn()

    expect(() => checkAllGameVersionsOnStartup([], fetchVersion, storeVersion)).not.toThrow()
    expect(fetchVersion).not.toHaveBeenCalled()
  })
})
