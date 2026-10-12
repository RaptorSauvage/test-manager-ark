import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { CurseForgeMod } from '../src/main/lib/curseforgeClient'

const mockGetSettings = vi.fn(() => ({ curseforgeApiKey: 'test-key' }))
vi.mock('../src/main/store', () => ({
  getSettings: () => mockGetSettings()
}))

const mockSearchCurseForgeArkMods = vi.fn()
const mockGetCurseForgeMods = vi.fn()
vi.mock('../src/main/lib/curseforgeClient', async () => {
  const actual = await vi.importActual<typeof import('../src/main/lib/curseforgeClient')>('../src/main/lib/curseforgeClient')
  return {
    ...actual,
    searchCurseForgeArkMods: (...args: unknown[]) => mockSearchCurseForgeArkMods(...args),
    getCurseForgeMods: (...args: unknown[]) => mockGetCurseForgeMods(...args)
  }
})

import { searchArkMods, getArkModsInfo } from '../src/main/lib/arkMods'

function makeMod(overrides: Partial<CurseForgeMod> = {}): CurseForgeMod {
  return {
    id: 900,
    slug: 's-plus',
    name: 'Structures Plus (S+)',
    summary: 'Expands building options',
    downloadCount: 123456,
    logo: { thumbnailUrl: 'https://example.test/s-plus.png' },
    allowModDistribution: true,
    ...overrides
  }
}

describe('searchArkMods', () => {
  beforeEach(() => {
    mockGetSettings.mockReturnValue({ curseforgeApiKey: 'test-key' })
    mockSearchCurseForgeArkMods.mockReset()
  })

  it('maps CurseForge hits into ArkModSearchResult', async () => {
    mockSearchCurseForgeArkMods.mockResolvedValue([makeMod()])

    const results = await searchArkMods('s+')

    expect(results).toEqual([
      {
        id: '900',
        name: 'Structures Plus (S+)',
        summary: 'Expands building options',
        iconUrl: 'https://example.test/s-plus.png',
        downloads: 123456
      }
    ])
  })

  it('falls back to no iconUrl when the mod has no logo', async () => {
    mockSearchCurseForgeArkMods.mockResolvedValue([makeMod({ logo: null })])

    const [result] = await searchArkMods('s+')

    expect(result.iconUrl).toBeUndefined()
  })

  it('returns an empty list, without calling CurseForge, when no API key is configured', async () => {
    mockGetSettings.mockReturnValue({ curseforgeApiKey: '' })

    const results = await searchArkMods('s+')

    expect(results).toEqual([])
    expect(mockSearchCurseForgeArkMods).not.toHaveBeenCalled()
  })
})

describe('getArkModsInfo', () => {
  beforeEach(() => {
    mockGetSettings.mockReturnValue({ curseforgeApiKey: 'test-key' })
    mockGetCurseForgeMods.mockReset()
  })

  it('returns a map keyed by id, built from a batched CurseForge lookup', async () => {
    mockGetCurseForgeMods.mockResolvedValue([makeMod({ id: 900 }), makeMod({ id: 901, name: 'Other Mod', logo: null })])

    const info = await getArkModsInfo(['900', '901'])

    expect(info).toEqual({
      '900': { name: 'Structures Plus (S+)', iconUrl: 'https://example.test/s-plus.png' },
      '901': { name: 'Other Mod', iconUrl: undefined }
    })
    expect(mockGetCurseForgeMods).toHaveBeenCalledWith('test-key', [900, 901])
  })

  it('omits an id CurseForge does not recognize, rather than erroring', async () => {
    mockGetCurseForgeMods.mockResolvedValue([])

    const info = await getArkModsInfo(['999999'])

    expect(info).toEqual({})
  })

  it('ignores non-numeric ids (e.g. a Steam Workshop id from an ARK: Survival Evolved profile) instead of sending them to CurseForge', async () => {
    mockGetCurseForgeMods.mockResolvedValue([])

    await getArkModsInfo(['not-a-number', ''])

    expect(mockGetCurseForgeMods).not.toHaveBeenCalled()
  })

  it('deduplicates ids before calling CurseForge', async () => {
    mockGetCurseForgeMods.mockResolvedValue([makeMod({ id: 900 })])

    await getArkModsInfo(['900', '900'])

    expect(mockGetCurseForgeMods).toHaveBeenCalledWith('test-key', [900])
  })

  it('returns an empty map, without calling CurseForge, when no API key is configured', async () => {
    mockGetSettings.mockReturnValue({ curseforgeApiKey: '' })

    const info = await getArkModsInfo(['900'])

    expect(info).toEqual({})
    expect(mockGetCurseForgeMods).not.toHaveBeenCalled()
  })

  it('returns an empty map, without calling CurseForge, for an empty id list', async () => {
    const info = await getArkModsInfo([])

    expect(info).toEqual({})
    expect(mockGetCurseForgeMods).not.toHaveBeenCalled()
  })
})
