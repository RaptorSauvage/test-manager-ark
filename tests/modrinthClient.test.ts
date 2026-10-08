import { describe, expect, it } from 'vitest'
import { loaderCategoriesFor, buildModrinthFacets } from '../src/main/lib/modrinthClient'

describe('loaderCategoriesFor', () => {
  it('maps fabric/forge to their own single category', () => {
    expect(loaderCategoriesFor('fabric')).toEqual(['fabric'])
    expect(loaderCategoriesFor('forge')).toEqual(['forge'])
  })

  it('maps paper and spigot to the same cross-compatible category group', () => {
    expect(loaderCategoriesFor('paper')).toEqual(['paper', 'spigot', 'bukkit'])
    expect(loaderCategoriesFor('spigot')).toEqual(['paper', 'spigot', 'bukkit'])
  })

  it('returns no categories for vanilla/unknown - no mod ecosystem to filter by', () => {
    expect(loaderCategoriesFor('vanilla')).toEqual([])
    expect(loaderCategoriesFor('unknown')).toEqual([])
  })
})

describe('buildModrinthFacets', () => {
  it('always requires project_type:mod and excludes client-only (server_side:unsupported)', () => {
    const facets = JSON.parse(buildModrinthFacets('fabric', '1.20.1'))
    expect(facets[0]).toEqual(['project_type:mod'])
    expect(facets[1]).toEqual(['server_side:required', 'server_side:optional'])
  })

  it('adds a loader category facet (OR-ed) for a loader that has one', () => {
    const facets = JSON.parse(buildModrinthFacets('paper', '1.20.1'))
    expect(facets).toContainEqual(['categories:paper', 'categories:spigot', 'categories:bukkit'])
  })

  it('omits the loader facet entirely for vanilla/unknown', () => {
    const facets = JSON.parse(buildModrinthFacets('vanilla', '1.20.1'))
    expect(facets.some((group: string[]) => group[0].startsWith('categories:'))).toBe(false)
  })

  it('adds a game version facet when a Minecraft version is set', () => {
    const facets = JSON.parse(buildModrinthFacets('fabric', '1.20.1'))
    expect(facets).toContainEqual(['versions:1.20.1'])
  })

  it('omits the game version facet when none is set', () => {
    const facets = JSON.parse(buildModrinthFacets('fabric', ''))
    expect(facets.some((group: string[]) => group[0].startsWith('versions:'))).toBe(false)
  })

  it('trims whitespace from the game version before using it', () => {
    const facets = JSON.parse(buildModrinthFacets('fabric', '  1.20.1  '))
    expect(facets).toContainEqual(['versions:1.20.1'])
  })
})
