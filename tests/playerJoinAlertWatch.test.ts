import { describe, expect, it } from 'vitest'
import type { PlayerConnectionEvent } from '../src/main/lib/playerConnectionWatcher'
import { playerMatchesWatchlist } from '../src/main/lib/playerJoinAlertWatch'

const EVENT: PlayerConnectionEvent = {
  type: 'joined',
  playerName: 'LeRaptorSauvage',
  uniqueNetId: '0002dbe9ab20413e9b8e7e1562b76868'
}

describe('playerMatchesWatchlist', () => {
  it('matches case-insensitively by player name', () => {
    expect(playerMatchesWatchlist(EVENT, [{ id: '1', value: 'leraptorsauvage', label: '', createdAt: 0 }])).toBe(true)
  })

  it('matches case-insensitively by uniqueNetId', () => {
    expect(playerMatchesWatchlist(EVENT, [{ id: '1', value: '0002DBE9AB20413E9B8E7E1562B76868', label: '', createdAt: 0 }])).toBe(
      true
    )
  })

  it('returns false when nothing in the watchlist matches', () => {
    expect(playerMatchesWatchlist(EVENT, [{ id: '1', value: 'SomeoneElse', label: '', createdAt: 0 }])).toBe(false)
  })

  it('returns false for an empty watchlist', () => {
    expect(playerMatchesWatchlist(EVENT, [])).toBe(false)
  })
})
