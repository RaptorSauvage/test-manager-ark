import { describe, expect, it } from 'vitest'
import { parsePlayerList, parsePlayerListWithIds } from '../src/main/lib/rcon'

describe('parsePlayerList', () => {
  it('returns an empty list when no players are connected', () => {
    expect(parsePlayerList('No Players Connected')).toEqual([])
    expect(parsePlayerList('')).toEqual([])
  })

  it('extracts player names from numbered RCON lines', () => {
    const raw = ['0. Alice, 000211a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5', '1. Bob, 111211a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5'].join(
      '\n'
    )
    expect(parsePlayerList(raw)).toEqual(['Alice', 'Bob'])
  })

  it('falls back to the raw line when the format is unexpected', () => {
    expect(parsePlayerList('Some unexpected format')).toEqual(['Some unexpected format'])
  })
})

describe('parsePlayerListWithIds', () => {
  it('returns an empty list when no players are connected', () => {
    expect(parsePlayerListWithIds('No Players Connected')).toEqual([])
    expect(parsePlayerListWithIds('')).toEqual([])
  })

  it('extracts name+id pairs from numbered RCON lines', () => {
    const raw = ['0. Alice, 000211a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5', '1. Bob, 111211a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5'].join(
      '\n'
    )
    expect(parsePlayerListWithIds(raw)).toEqual([
      { name: 'Alice', id: '000211a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5' },
      { name: 'Bob', id: '111211a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5' }
    ])
  })

  it('skips a line with an unexpected format instead of guessing at an id', () => {
    expect(parsePlayerListWithIds('Some unexpected format')).toEqual([])
  })
})
