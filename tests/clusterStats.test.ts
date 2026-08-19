import { describe, expect, it } from 'vitest'
import type { ServerProfile, ServerStatus } from '../shared/types'
import { computeClusterGroupStats } from '../src/renderer/src/lib/clusterStats'

function profile(overrides: Partial<ServerProfile>): ServerProfile {
  return { id: 'p', group: '', hidden: false, maxPlayers: 70, ...overrides } as ServerProfile
}

function running(overrides: Partial<ServerStatus>): ServerStatus {
  return { profileId: 'p', state: 'running', cpu: 0, memoryMB: 0, players: [], ...overrides }
}

describe('computeClusterGroupStats', () => {
  it('sums cpu/memory/players across running servers in the same group', () => {
    const profiles = [
      profile({ id: 'a', group: 'Island', maxPlayers: 70 }),
      profile({ id: 'b', group: 'Island', maxPlayers: 70 })
    ]
    const statuses = {
      a: running({ profileId: 'a', cpu: 20, memoryMB: 4000, players: ['x', 'y'] }),
      b: running({ profileId: 'b', cpu: 30, memoryMB: 5000, players: ['z'] })
    }
    const result = computeClusterGroupStats(profiles, statuses)
    expect(result).toEqual([
      {
        group: 'Island',
        serverCount: 2,
        runningCount: 2,
        totalCpu: 50,
        totalMemoryMB: 9000,
        totalPlayers: 3,
        totalMaxPlayers: 140
      }
    ])
  })

  it('excludes a stopped server from the numeric totals but keeps it in serverCount', () => {
    const profiles = [
      profile({ id: 'a', group: 'Island', maxPlayers: 70 }),
      profile({ id: 'b', group: 'Island', maxPlayers: 70 })
    ]
    const statuses = {
      a: running({ profileId: 'a', cpu: 20, memoryMB: 4000, players: ['x'] }),
      b: { profileId: 'b', state: 'stopped' } as ServerStatus
    }
    const result = computeClusterGroupStats(profiles, statuses)
    expect(result[0]).toEqual({
      group: 'Island',
      serverCount: 2,
      runningCount: 1,
      totalCpu: 20,
      totalMemoryMB: 4000,
      totalPlayers: 1,
      totalMaxPlayers: 140
    })
  })

  it('excludes hidden profiles entirely', () => {
    const profiles = [profile({ id: 'a', group: 'Island', hidden: true })]
    const statuses = { a: running({ profileId: 'a', cpu: 50 }) }
    expect(computeClusterGroupStats(profiles, statuses)).toEqual([])
  })

  it('buckets profiles with no group under the empty-string "Ungrouped" key', () => {
    const profiles = [profile({ id: 'a', group: '  ' })]
    const statuses = { a: running({ profileId: 'a' }) }
    const result = computeClusterGroupStats(profiles, statuses)
    expect(result).toHaveLength(1)
    expect(result[0].group).toBe('')
  })

  it('sorts named groups alphabetically with the ungrouped bucket always last', () => {
    const profiles = [
      profile({ id: 'a', group: 'Zeta' }),
      profile({ id: 'b', group: '' }),
      profile({ id: 'c', group: 'Alpha' })
    ]
    const result = computeClusterGroupStats(profiles, {})
    expect(result.map((g) => g.group)).toEqual(['Alpha', 'Zeta', ''])
  })

  it('returns an empty array for no profiles', () => {
    expect(computeClusterGroupStats([], {})).toEqual([])
  })
})
