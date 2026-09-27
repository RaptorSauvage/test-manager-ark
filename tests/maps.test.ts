import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => '/fake/documents', getName: () => 'ark-server-manager' } }))

const { getDefaultMaps, getMapsFilePath, parseMapsFile } = await import('../src/main/lib/maps')

describe('getDefaultMaps', () => {
  it("includes The Island as TheIsland_WP for ark-ascended", () => {
    const maps = getDefaultMaps('ark-ascended')
    expect(maps).toContainEqual({ id: 'TheIsland_WP', displayName: 'The Island' })
  })

  it('has no duplicate ids for ark-ascended', () => {
    const ids = getDefaultMaps('ark-ascended').map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("includes The Island as TheIsland (no _WP suffix) for ark-evolved", () => {
    const maps = getDefaultMaps('ark-evolved')
    expect(maps).toContainEqual({ id: 'TheIsland', displayName: 'The Island' })
    expect(maps.some((m) => m.id === 'TheIsland_WP')).toBe(false)
  })

  it('has no duplicate ids for ark-evolved', () => {
    const ids = getDefaultMaps('ark-evolved').map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('getMapsFilePath', () => {
  it("keeps the original 'maps.json' name for ark-ascended (no existing install's file moves)", () => {
    expect(path.basename(getMapsFilePath('ark-ascended'))).toBe('maps.json')
  })

  it('uses a distinct file for ark-evolved', () => {
    expect(path.basename(getMapsFilePath('ark-evolved'))).toBe('maps-ark-evolved.json')
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
