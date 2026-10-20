import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import Store from 'electron-store'
import {
  setRunningPid,
  setRunningStartedAt,
  getRunningPids,
  getRunningStartedAt,
  listPlayerBans,
  recordPlayerBan,
  removePlayerBanProfile,
  listWatchedPlayers,
  addWatchedPlayer,
  removeWatchedPlayer,
  listPlayerActivity,
  listPlayerSessions,
  recordPlayerSession,
  listConfigFileHistory,
  getConfigFileHistoryEntry,
  recordConfigFileHistory
} from '../src/main/store'

describe('setRunningPid/setRunningStartedAt', () => {
  it('persists normally when nothing goes wrong', () => {
    setRunningPid('resilience-test-normal', 4242)
    expect(getRunningPids()['resilience-test-normal']).toBe(4242)
    setRunningPid('resilience-test-normal', null)
    expect(getRunningPids()['resilience-test-normal']).toBeUndefined()
  })

  it('never throws when the underlying disk write fails - a real report on Windows had this skip the emitStatus() call right after it', () => {
    // finalizeStopped/startServer in serverProcess.ts call setRunningPid/setRunningStartedAt
    // immediately before emitStatus() - the one call that actually updates the renderer's
    // view of a server's state. If either threw, emitStatus() would never run, leaving a
    // server stuck showing the wrong state in the UI even though the Manager's own internal
    // tracking had already moved on (see the fix's own comment in store.ts).
    const spy = vi.spyOn(Store.prototype, 'set').mockImplementation(() => {
      throw Object.assign(new Error('unknown error, write'), { code: 'UNKNOWN', errno: -4094 })
    })
    try {
      expect(() => setRunningPid('resilience-test-throw', 1234)).not.toThrow()
      expect(() => setRunningStartedAt('resilience-test-throw', Date.now())).not.toThrow()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('listPlayerBans/recordPlayerBan/removePlayerBanProfile', () => {
  it('merges bans for the same player id across servers into one row', () => {
    recordPlayerBan('steam-resilience-1', 'Griefer', 'raiding spawn', 'profile-a')
    recordPlayerBan('steam-resilience-1', 'Griefer', 'raiding spawn', 'profile-b')
    const bans = listPlayerBans()
    const ban = bans.find((b) => b.id === 'steam-resilience-1')
    expect(ban?.profileIds).toEqual(['profile-a', 'profile-b'])

    removePlayerBanProfile('steam-resilience-1', 'profile-a')
    removePlayerBanProfile('steam-resilience-1', 'profile-b')
    expect(listPlayerBans().some((b) => b.id === 'steam-resilience-1')).toBe(false)
  })

  it('drops the ban entirely once its last profile is unbanned', () => {
    recordPlayerBan('steam-resilience-2', 'Lonely', 'test', 'profile-only')
    expect(listPlayerBans().some((b) => b.id === 'steam-resilience-2')).toBe(true)

    removePlayerBanProfile('steam-resilience-2', 'profile-only')
    expect(listPlayerBans().some((b) => b.id === 'steam-resilience-2')).toBe(false)
  })
})

describe('listWatchedPlayers/addWatchedPlayer/removeWatchedPlayer', () => {
  it('adds, lists, and removes a watched player', () => {
    const entry = { id: 'watch-resilience-1', value: 'SomeStreamer', label: 'Streamer de test', createdAt: Date.now() }
    addWatchedPlayer(entry)
    expect(listWatchedPlayers().some((p) => p.id === 'watch-resilience-1')).toBe(true)

    removeWatchedPlayer('watch-resilience-1')
    expect(listWatchedPlayers().some((p) => p.id === 'watch-resilience-1')).toBe(false)
  })
})

describe('listPlayerActivity/listPlayerSessions/recordPlayerSession', () => {
  it('accumulates total playtime and session count across multiple sessions on different servers', () => {
    // A fresh random id each run, not a fixed literal - unlike playerBans/watchedPlayers
    // above, there's no delete function for a player's activity record (it's meant to
    // accumulate forever), so a repeat run against the real on-disk store would otherwise
    // keep adding onto whatever an earlier run already left behind for the same id.
    const playerId = randomUUID()
    const start = Date.now()
    recordPlayerSession('profile-activity-a', playerId, 'Survivor', start, start + 60_000)
    recordPlayerSession('profile-activity-b', playerId, 'Survivor', start, start + 30_000)

    const record = listPlayerActivity().find((r) => r.id === playerId)
    expect(record?.totalPlaytimeMs).toBe(90_000)
    expect(record?.sessionCount).toBe(2)
    expect(record?.profileIds).toEqual(['profile-activity-a', 'profile-activity-b'])
  })

  it('records a closed session into the recent-sessions log, most recent first', () => {
    const playerId = randomUUID()
    const start = Date.now()
    recordPlayerSession('profile-activity-c', playerId, 'Newcomer', start, start + 5_000)

    const sessions = listPlayerSessions()
    expect(sessions[0]).toMatchObject({ profileId: 'profile-activity-c', playerId, playerName: 'Newcomer' })
  })

  it('never lets a negative duration (clock skew) subtract from the total', () => {
    const playerId = randomUUID()
    const start = Date.now()
    recordPlayerSession('profile-activity-d', playerId, 'Confused', start, start - 10_000)

    const record = listPlayerActivity().find((r) => r.id === playerId)
    expect(record?.totalPlaytimeMs).toBe(0)
  })
})

describe('listConfigFileHistory/getConfigFileHistoryEntry/recordConfigFileHistory', () => {
  it('lists entries for one profile+path newest first, without the others', () => {
    const profileId = randomUUID()
    recordConfigFileHistory(profileId, 'Test.ini', 'first')
    recordConfigFileHistory(profileId, 'Test.ini', 'second')
    recordConfigFileHistory(profileId, 'Other.ini', 'unrelated')

    const history = listConfigFileHistory(profileId, 'Test.ini')
    expect(history.map((e) => e.content)).toEqual(['second', 'first'])
  })

  it('fetches a single entry by id with getConfigFileHistoryEntry', () => {
    const profileId = randomUUID()
    recordConfigFileHistory(profileId, 'Test.ini', 'the content')
    const entry = listConfigFileHistory(profileId, 'Test.ini')[0]

    expect(getConfigFileHistoryEntry(entry.id)?.content).toBe('the content')
    expect(getConfigFileHistoryEntry('does-not-exist')).toBeUndefined()
  })

  it("caps one file's own history without trimming another file's", () => {
    const profileId = randomUUID()
    for (let i = 0; i < 25; i++) recordConfigFileHistory(profileId, 'Busy.ini', 'version ' + i)
    recordConfigFileHistory(profileId, 'Quiet.ini', 'only version')

    const busyHistory = listConfigFileHistory(profileId, 'Busy.ini')
    expect(busyHistory).toHaveLength(20)
    expect(busyHistory[0].content).toBe('version 24')
    expect(busyHistory[busyHistory.length - 1].content).toBe('version 5')
    expect(listConfigFileHistory(profileId, 'Quiet.ini')).toHaveLength(1)
  })
})
