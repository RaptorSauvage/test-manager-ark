import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  searchCurseForgeMods,
  searchCurseForgeArkMods,
  getCurseForgeModFiles,
  getCurseForgeFingerprintMatches,
  type CurseForgeFile
} from '../src/main/lib/curseforgeClient'

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

function makeFile(overrides: Partial<CurseForgeFile> = {}): CurseForgeFile {
  return {
    id: 1,
    modId: 100,
    fileName: 'mod-1.0.0.jar',
    displayName: '1.0.0',
    downloadUrl: 'https://example.test/mod-1.0.0.jar',
    gameVersions: ['1.20.1'],
    fileDate: '2026-01-01T00:00:00Z',
    hashes: [],
    dependencies: [],
    fileFingerprint: 0,
    ...overrides
  }
}

describe('searchCurseForgeMods', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the Mods class id and modLoaderType for Forge/Fabric', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await searchCurseForgeMods('key', 'jei', 'fabric', '1.20.1')

    const url = fetchMock.mock.calls[0][0] as URL
    expect(url.searchParams.get('classId')).toBe('6')
    expect(url.searchParams.get('modLoaderType')).toBe('4')
    expect(url.searchParams.get('gameVersion')).toBe('1.20.1')
    expect(url.searchParams.get('gameId')).toBe('432')
  })

  it('uses the Mods class id and modLoaderType 6 for NeoForge', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await searchCurseForgeMods('key', 'jei', 'neoforge', '1.21.1')

    const url = fetchMock.mock.calls[0][0] as URL
    expect(url.searchParams.get('classId')).toBe('6')
    expect(url.searchParams.get('modLoaderType')).toBe('6')
  })

  it('uses the Bukkit Plugins class id and omits modLoaderType for Paper/Spigot', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await searchCurseForgeMods('key', 'worldedit', 'paper', '1.20.1')

    const url = fetchMock.mock.calls[0][0] as URL
    expect(url.searchParams.get('classId')).toBe('4471')
    expect(url.searchParams.has('modLoaderType')).toBe(false)
  })

  it('sends the API key as the x-api-key header', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await searchCurseForgeMods('my-secret-key', 'jei', 'forge', '1.20.1')

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('my-secret-key')
  })

  it('throws a clear message on a 401/403 (bad key)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({}, false, 401)))
    await expect(searchCurseForgeMods('bad-key', 'jei', 'forge', '1.20.1')).rejects.toThrow(/API key/)
  })
})

describe('searchCurseForgeArkMods', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses ARK: Survival Ascended\'s own game id, with no classId or modLoaderType', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await searchCurseForgeArkMods('key', 'structures plus')

    const url = fetchMock.mock.calls[0][0] as URL
    expect(url.searchParams.get('gameId')).toBe('83374')
    expect(url.searchParams.has('classId')).toBe(false)
    expect(url.searchParams.has('modLoaderType')).toBe(false)
    expect(url.searchParams.get('searchFilter')).toBe('structures plus')
  })

  it('throws a clear message on a 401/403 (bad key)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({}, false, 401)))
    await expect(searchCurseForgeArkMods('bad-key', 's+')).rejects.toThrow(/API key/)
  })
})

describe('getCurseForgeModFiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sorts files newest-first by fileDate, regardless of response order', async () => {
    const older = makeFile({ id: 1, fileDate: '2025-01-01T00:00:00Z' })
    const newer = makeFile({ id: 2, fileDate: '2026-01-01T00:00:00Z' })
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ data: [older, newer] })))

    const files = await getCurseForgeModFiles('key', 100, 'forge', '1.20.1')

    expect(files[0].id).toBe(2)
    expect(files[1].id).toBe(1)
  })
})

describe('getCurseForgeFingerprintMatches', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an empty array without calling fetch for an empty fingerprint list', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const matches = await getCurseForgeFingerprintMatches('key', [])

    expect(matches).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns exactMatches from the response', async () => {
    const match = { id: 100, file: makeFile() }
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ data: { exactMatches: [match] } })))

    const matches = await getCurseForgeFingerprintMatches('key', [123456])

    expect(matches).toEqual([match])
  })
})
