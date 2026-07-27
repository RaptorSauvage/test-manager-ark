import { describe, expect, it } from 'vitest'
import { parseImportedMods, serializeMods } from '../src/main/lib/modsExport'
import type { ServerMod } from '../shared/types'

describe('serializeMods / parseImportedMods', () => {
  it('round-trips a mod list', () => {
    const mods: ServerMod[] = [
      { id: '111', name: 'Bober Stacks', enabled: true, passive: false, dev: false },
      { id: '222', enabled: false, passive: true, dev: true }
    ]
    expect(parseImportedMods(serializeMods(mods))).toEqual(mods)
  })

  it('rejects invalid JSON', () => {
    expect(() => parseImportedMods('not json')).toThrow(/not valid JSON/)
  })

  it('rejects a JSON value that is not an array', () => {
    expect(() => parseImportedMods('{"id": "111"}')).toThrow(/must contain a JSON array/)
  })

  it('rejects an entry missing a string id', () => {
    expect(() => parseImportedMods(JSON.stringify([{ enabled: true }]))).toThrow(/entry 0/)
  })

  it('backfills missing enabled/passive/dev flags', () => {
    const [mod] = parseImportedMods(JSON.stringify([{ id: '333' }]))
    expect(mod).toEqual({ id: '333', name: undefined, enabled: true, passive: false, dev: false })
  })

  it('accepts an empty array', () => {
    expect(parseImportedMods('[]')).toEqual([])
  })
})
