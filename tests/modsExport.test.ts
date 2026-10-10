import { describe, expect, it } from 'vitest'
import { parseImportedMods, serializeMods } from '../src/main/lib/modsExport'
import type { ServerMod } from '../shared/types'

describe('serializeMods', () => {
  it('serializes to one bare id per line, dropping name/enabled/passive/dev', () => {
    const mods: ServerMod[] = [
      { id: '111', name: 'Bober Stacks', enabled: true, passive: false, dev: false },
      { id: '222', enabled: false, passive: true, dev: true }
    ]
    expect(serializeMods(mods)).toBe('111\n222')
  })

  it('serializes an empty list to an empty string', () => {
    expect(serializeMods([])).toBe('')
  })
})

describe('parseImportedMods', () => {
  it('parses one id per line, defaulting enabled/passive/dev the same way a manually-added mod does', () => {
    expect(parseImportedMods('111\n222')).toEqual([
      { id: '111', enabled: true, passive: false, dev: false },
      { id: '222', enabled: true, passive: false, dev: false }
    ])
  })

  it('round-trips through serializeMods, modulo the dropped name/enabled/passive/dev', () => {
    const mods: ServerMod[] = [
      { id: '111', name: 'Bober Stacks', enabled: false, passive: true, dev: true },
      { id: '222', enabled: true, passive: false, dev: false }
    ]
    expect(parseImportedMods(serializeMods(mods))).toEqual([
      { id: '111', enabled: true, passive: false, dev: false },
      { id: '222', enabled: true, passive: false, dev: false }
    ])
  })

  it('accepts ids separated by commas, spaces, or a mix, not just newlines - a list pasted in from anywhere', () => {
    expect(parseImportedMods('111, 222   333,444\n555')).toEqual([
      { id: '111', enabled: true, passive: false, dev: false },
      { id: '222', enabled: true, passive: false, dev: false },
      { id: '333', enabled: true, passive: false, dev: false },
      { id: '444', enabled: true, passive: false, dev: false },
      { id: '555', enabled: true, passive: false, dev: false }
    ])
  })

  it('dedupes repeated ids, keeping the first occurrence only', () => {
    expect(parseImportedMods('111\n222\n111')).toEqual([
      { id: '111', enabled: true, passive: false, dev: false },
      { id: '222', enabled: true, passive: false, dev: false }
    ])
  })

  it('ignores surrounding/blank whitespace', () => {
    expect(parseImportedMods('  \n 111 \n\n  222  \n ')).toEqual([
      { id: '111', enabled: true, passive: false, dev: false },
      { id: '222', enabled: true, passive: false, dev: false }
    ])
  })

  it('rejects text with no numeric ids in it at all', () => {
    expect(() => parseImportedMods('not a mod id list')).toThrow(/No mod ids found/)
    expect(() => parseImportedMods('')).toThrow(/No mod ids found/)
  })
})
