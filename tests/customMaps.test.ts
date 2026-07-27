import { describe, expect, it } from 'vitest'
import { getDefaultCustomMaps, parseCustomMapsFile } from '../src/main/lib/customMaps'

describe('getDefaultCustomMaps', () => {
  it('seeds just a None entry (empty id) - custom maps are user-specific, everything else is user-added', () => {
    expect(getDefaultCustomMaps()).toEqual([{ id: '', displayName: 'None' }])
  })
})

describe('parseCustomMapsFile', () => {
  it('parses a valid custom maps array', () => {
    const json = JSON.stringify([{ id: '123456', displayName: 'My Modded Map' }])
    expect(parseCustomMapsFile(json)).toEqual([{ id: '123456', displayName: 'My Modded Map' }])
  })

  it('rejects invalid JSON', () => {
    expect(() => parseCustomMapsFile('not json')).toThrow(/not valid JSON/)
  })

  it('rejects a JSON value that is not an array', () => {
    expect(() => parseCustomMapsFile('{"id": "123456"}')).toThrow(/must contain a JSON array/)
  })

  it('rejects an entry missing id or displayName', () => {
    expect(() => parseCustomMapsFile(JSON.stringify([{ id: '123456' }]))).toThrow(/entry 0/)
  })

  it('accepts an empty array', () => {
    expect(parseCustomMapsFile('[]')).toEqual([])
  })
})
