import { describe, expect, it } from 'vitest'
import { parsePlayerList } from '../src/main/lib/rcon'

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
