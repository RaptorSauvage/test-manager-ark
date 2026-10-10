import { describe, expect, it, vi, afterEach } from 'vitest'
import { loaderCategoriesFor, buildModrinthFacets, getModrinthProject } from '../src/main/lib/modrinthClient'

function fakeResponse(init: { ok: boolean; status: number; retryAfter?: string; body?: unknown }): Response {
  const headers = new Headers()
  if (init.retryAfter) headers.set('Retry-After', init.retryAfter)
  return {
    ok: init.ok,
    status: init.status,
    headers,
    json: async () => init.body
  } as unknown as Response
}

describe('loaderCategoriesFor', () => {
  it('maps fabric/forge/neoforge to their own single category under ecosystem "mods"', () => {
    expect(loaderCategoriesFor('fabric', 'mods')).toEqual(['fabric'])
    expect(loaderCategoriesFor('forge', 'mods')).toEqual(['forge'])
    expect(loaderCategoriesFor('neoforge', 'mods')).toEqual(['neoforge'])
  })

  it('maps paper and spigot to the same cross-compatible category group under ecosystem "plugins"', () => {
    expect(loaderCategoriesFor('paper', 'plugins')).toEqual(['paper', 'spigot', 'bukkit'])
    expect(loaderCategoriesFor('spigot', 'plugins')).toEqual(['paper', 'spigot', 'bukkit'])
  })

  it('maps spongevanilla and spongeforge to the same implementation-agnostic sponge category under ecosystem "plugins"', () => {
    expect(loaderCategoriesFor('spongevanilla', 'plugins')).toEqual(['sponge'])
    expect(loaderCategoriesFor('spongeforge', 'plugins')).toEqual(['sponge'])
  })

  it('maps spongeforge to plain forge under ecosystem "mods" - its own underlying Forge-mod layer, distinct from its Sponge-plugin layer', () => {
    expect(loaderCategoriesFor('spongeforge', 'mods')).toEqual(['forge'])
  })

  it('returns no categories for a server type with no ecosystem of the requested kind at all (vanilla/unknown, or the "wrong" ecosystem for a single-ecosystem type)', () => {
    expect(loaderCategoriesFor('vanilla', 'mods')).toEqual([])
    expect(loaderCategoriesFor('unknown', 'plugins')).toEqual([])
    expect(loaderCategoriesFor('forge', 'plugins')).toEqual([])
    expect(loaderCategoriesFor('paper', 'mods')).toEqual([])
  })
})

describe('buildModrinthFacets', () => {
  it('requires project_type mod OR plugin (both are real, distinct Modrinth types - filtering to mod alone silently excluded every plugin) and excludes client-only (server_side:unsupported)', () => {
    const facets = JSON.parse(buildModrinthFacets('fabric', '1.20.1', 'mods'))
    expect(facets[0]).toEqual(['project_type:mod', 'project_type:plugin'])
    expect(facets[1]).toEqual(['server_side:required', 'server_side:optional'])
  })

  it('still requires project_type mod OR plugin for a plugin-ecosystem loader (Paper/Spigot/Sponge) too - not narrowed to plugin only', () => {
    const facets = JSON.parse(buildModrinthFacets('paper', '1.20.1', 'plugins'))
    expect(facets[0]).toEqual(['project_type:mod', 'project_type:plugin'])
  })

  it('adds a loader category facet (OR-ed) for a loader that has one', () => {
    const facets = JSON.parse(buildModrinthFacets('paper', '1.20.1', 'plugins'))
    expect(facets).toContainEqual(['categories:paper', 'categories:spigot', 'categories:bukkit'])
  })

  it('omits the loader facet entirely for vanilla/unknown', () => {
    const facets = JSON.parse(buildModrinthFacets('vanilla', '1.20.1', 'mods'))
    expect(facets.some((group: string[]) => group[0].startsWith('categories:'))).toBe(false)
  })

  it('picks the Sponge-plugin category or the Forge-mod category for SpongeForge, depending on which ecosystem is asked for', () => {
    const pluginsFacets = JSON.parse(buildModrinthFacets('spongeforge', '1.20.1', 'plugins'))
    expect(pluginsFacets).toContainEqual(['categories:sponge'])
    const modsFacets = JSON.parse(buildModrinthFacets('spongeforge', '1.20.1', 'mods'))
    expect(modsFacets).toContainEqual(['categories:forge'])
  })

  it('adds a game version facet when a Minecraft version is set', () => {
    const facets = JSON.parse(buildModrinthFacets('fabric', '1.20.1', 'mods'))
    expect(facets).toContainEqual(['versions:1.20.1'])
  })

  it('omits the game version facet when none is set', () => {
    const facets = JSON.parse(buildModrinthFacets('fabric', '', 'mods'))
    expect(facets.some((group: string[]) => group[0].startsWith('versions:'))).toBe(false)
  })

  it('trims whitespace from the game version before using it', () => {
    const facets = JSON.parse(buildModrinthFacets('fabric', '  1.20.1  ', 'mods'))
    expect(facets).toContainEqual(['versions:1.20.1'])
  })
})

describe('modrinthFetch rate-limit retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('waits out a 429\'s Retry-After header, then retries and returns the successful response', async () => {
    const project = {
      id: 'project-root',
      slug: 'root-mod',
      title: 'Root Mod',
      description: '',
      icon_url: null,
      client_side: 'optional',
      server_side: 'required'
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 429, retryAfter: '1' }))
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: project }))
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)

    const promise = getModrinthProject('project-root')
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result).toEqual(project)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting retries and throws, instead of retrying forever', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 429 }))
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)

    const expectation = expect(getModrinthProject('project-root')).rejects.toThrow(/HTTP 429/)
    await vi.advanceTimersByTimeAsync(20000)
    await expectation

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
