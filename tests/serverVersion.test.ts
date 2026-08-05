import { describe, expect, it, vi } from 'vitest'
import {
  parseGameVersionFromTitle,
  getWindowTitle,
  findAnyArkServerWindowTitle,
  getGameVersion,
  getCachedGameVersion,
  setCachedGameVersion,
  clearCachedGameVersion
} from '../src/main/lib/serverVersion'

describe('parseGameVersionFromTitle', () => {
  it('extracts the version from a real ARK:SA console title', () => {
    const title =
      'ASA 92.28 | [Aberration] Culte de Bober | Aberration_WP | PvP | Process 125696 | Players: 0/70 | Mem: 7.7 GB'
    expect(parseGameVersionFromTitle(title)).toBe('92.28')
  })

  it('handles a version with more than two segments', () => {
    expect(parseGameVersionFromTitle('ASA 1.2.3 | Session')).toBe('1.2.3')
  })

  it('tolerates leading/trailing whitespace', () => {
    expect(parseGameVersionFromTitle('  ASA 92.28 | Session  ')).toBe('92.28')
  })

  it('returns null for a title that does not start with "ASA <version>"', () => {
    expect(parseGameVersionFromTitle('Some Other Window')).toBeNull()
    expect(parseGameVersionFromTitle('')).toBeNull()
  })
})

describe('getWindowTitle', () => {
  it('resolves to null on non-Windows platforms without spawning anything', async () => {
    if (process.platform === 'win32') return
    expect(await getWindowTitle(1234)).toBeNull()
  })

  it('resolves to null for a non-positive or non-integer pid', async () => {
    expect(await getWindowTitle(0)).toBeNull()
    expect(await getWindowTitle(-1)).toBeNull()
    expect(await getWindowTitle(1.5)).toBeNull()
  })
})

describe('findAnyArkServerWindowTitle', () => {
  it('resolves to null on non-Windows platforms without spawning anything', async () => {
    if (process.platform === 'win32') return
    expect(await findAnyArkServerWindowTitle()).toBeNull()
  })
})

describe('getGameVersion', () => {
  it('resolves to null when there is no window title to parse (e.g. non-Windows)', async () => {
    if (process.platform === 'win32') return
    expect(await getGameVersion(1234)).toBeNull()
  })

  it('uses the direct pid lookup when it resolves to a valid title', async () => {
    const fetchWindowTitle = vi.fn().mockResolvedValue('ASA 92.28 | Session | TheIsland_WP | PvP | Process 1234')
    const fetchFallbackTitle = vi.fn()
    const version = await getGameVersion(1234, fetchWindowTitle, fetchFallbackTitle)
    expect(version).toBe('92.28')
    expect(fetchFallbackTitle).not.toHaveBeenCalled()
  })

  it('falls back to scanning all windows when the direct pid lookup finds nothing', async () => {
    const fetchWindowTitle = vi.fn().mockResolvedValue(null)
    const fetchFallbackTitle = vi.fn().mockResolvedValue('ASA 92.28 | Session | TheIsland_WP | PvP | Process 9999')
    const version = await getGameVersion(1234, fetchWindowTitle, fetchFallbackTitle)
    expect(version).toBe('92.28')
    expect(fetchFallbackTitle).toHaveBeenCalledTimes(1)
  })

  it('falls back when the direct title exists but does not parse as a version', async () => {
    const fetchWindowTitle = vi.fn().mockResolvedValue('Some Unrelated Window')
    const fetchFallbackTitle = vi.fn().mockResolvedValue('ASA 92.28 | Session | TheIsland_WP')
    const version = await getGameVersion(1234, fetchWindowTitle, fetchFallbackTitle)
    expect(version).toBe('92.28')
  })

  it('resolves to null when both the direct lookup and the fallback find nothing', async () => {
    const fetchWindowTitle = vi.fn().mockResolvedValue(null)
    const fetchFallbackTitle = vi.fn().mockResolvedValue(null)
    expect(await getGameVersion(1234, fetchWindowTitle, fetchFallbackTitle)).toBeNull()
  })
})

describe('game version cache', () => {
  it('returns null for a profile that has never been cached', () => {
    expect(getCachedGameVersion('never-cached-profile')).toBeNull()
  })

  it('returns whatever was stored for that profile', () => {
    setCachedGameVersion('profile-a', '92.28')
    expect(getCachedGameVersion('profile-a')).toBe('92.28')
  })

  it('keeps separate profiles independent', () => {
    setCachedGameVersion('profile-b', '92.28')
    setCachedGameVersion('profile-c', '93.0')
    expect(getCachedGameVersion('profile-b')).toBe('92.28')
    expect(getCachedGameVersion('profile-c')).toBe('93.0')
  })

  it('clears only the requested profile', () => {
    setCachedGameVersion('profile-d', '92.28')
    setCachedGameVersion('profile-e', '92.28')
    clearCachedGameVersion('profile-d')
    expect(getCachedGameVersion('profile-d')).toBeNull()
    expect(getCachedGameVersion('profile-e')).toBe('92.28')
  })

  it('clearing an uncached profile is a no-op, not an error', () => {
    expect(() => clearCachedGameVersion('was-never-cached')).not.toThrow()
  })
})
