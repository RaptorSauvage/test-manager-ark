import { describe, expect, it } from 'vitest'
import { getDefaultCustomMaps, parseCustomMapsFile } from '../src/main/lib/customMaps'

describe('getDefaultCustomMaps', () => {
  it('seeds an empty list - custom maps are entirely user-added', () => {
    expect(getDefaultCustomMaps()).toEqual([])
  })
})

describe('parseCustomMapsFile', () => {
  it('parses a valid custom maps array', () => {
    const json = JSON.stringify([{ id: 'MyCustomMap_WP', displayName: 'My Modded Map' }])
    expect(parseCustomMapsFile(json)).toEqual([{ id: 'MyCustomMap_WP', displayName: 'My Modded Map' }])
  })

  it('rejects invalid JSON', () => {
    expect(() => parseCustomMapsFile('not json')).toThrow(/not valid JSON/)
  })

  it('rejects a JSON value that is not an array', () => {
    expect(() => parseCustomMapsFile('{"id": "MyCustomMap_WP"}')).toThrow(/must contain a JSON array/)
  })

  it('rejects an entry missing id or displayName', () => {
    expect(() => parseCustomMapsFile(JSON.stringify([{ id: 'MyCustomMap_WP' }]))).toThrow(/entry 0/)
  })

  it('accepts an empty array', () => {
    expect(parseCustomMapsFile('[]')).toEqual([])
  })
})
