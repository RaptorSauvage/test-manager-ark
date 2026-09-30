import { describe, expect, it } from 'vitest'
import { parseMinecraftPlayerList } from '../src/main/lib/minecraftRcon'

describe('parseMinecraftPlayerList', () => {
  it('returns no players for an empty response', () => {
    expect(parseMinecraftPlayerList('')).toEqual({ players: [] })
  })

  it('parses the "of a max of" wording with players listed', () => {
    expect(parseMinecraftPlayerList('There are 2 of a max of 20 players online: Alice, Bob')).toEqual({
      players: ['Alice', 'Bob'],
      maxPlayers: 20
    })
  })

  it('parses the "X/Y players online" wording', () => {
    expect(parseMinecraftPlayerList('There are 1/20 players online: Alice')).toEqual({
      players: ['Alice'],
      maxPlayers: 20
    })
  })

  it('parses zero players online with no trailing names', () => {
    expect(parseMinecraftPlayerList('There are 0 of a max of 20 players online:')).toEqual({
      players: [],
      maxPlayers: 20
    })
  })

  it('trims whitespace around player names', () => {
    expect(parseMinecraftPlayerList('There are 2/20 players online:  Alice ,  Bob ')).toEqual({
      players: ['Alice', 'Bob'],
      maxPlayers: 20
    })
  })
})
