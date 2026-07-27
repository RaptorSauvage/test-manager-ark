import { describe, expect, it } from 'vitest'
import { getDefaultMaps, parseMapsFile } from '../src/main/lib/maps'

describe('getDefaultMaps', () => {
  it('includes The Island as TheIsland_WP', () => {
    const maps = getDefaultMaps()
    expect(maps).toContainEqual({ id: 'TheIsland_WP', displayName: 'The Island' })
  })

  it('has no duplicate ids', () => {
    const ids = getDefaultMaps().map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('parseMapsFile', () => {
  it('parses a valid maps array', () => {
    const json = JSON.stringify([
      { id: 'TheIsland_WP', displayName: 'The Island' },
      { id: 'MyModdedMap_WP', displayName: 'My Modded Map' }
    ])
    expect(parseMapsFile(json)).toEqual([
      { id: 'TheIsland_WP', displayName: 'The Island' },
      { id: 'MyModdedMap_WP', displayName: 'My Modded Map' }
    ])
  })

  it('rejects invalid JSON', () => {
    expect(() => parseMapsFile('not json')).toThrow(/not valid JSON/)
  })

  it('rejects a JSON value that is not an array', () => {
    expect(() => parseMapsFile('{"id": "TheIsland_WP"}')).toThrow(/must contain a JSON array/)
  })

  it('rejects an entry missing id or displayName', () => {
    expect(() => parseMapsFile(JSON.stringify([{ id: 'TheIsland_WP' }]))).toThrow(/entry 0/)
    expect(() => parseMapsFile(JSON.stringify([{ displayName: 'The Island' }]))).toThrow(/entry 0/)
  })

  it('accepts an empty array', () => {
    expect(parseMapsFile('[]')).toEqual([])
  })
})
