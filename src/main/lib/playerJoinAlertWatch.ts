import type { ServerStatus, WatchedPlayerAlert } from '@shared/types'
import type { ServerProfile } from '@shared/types'
import { isRunning, serverEvents } from './serverProcess'
import { getProfile, getSettings, listProfiles, listWatchedPlayers } from '../store'
import { watchPlayerConnectionEvents, type PlayerConnectionEvent } from './playerConnectionWatcher'
import { notifyPlayerJoin } from './discordBot'

const stopFns = new Map<string, () => void>()

/** Pure matcher, kept separate from the live store read so it can be unit tested on its
 *  own - case-insensitive against either the joining player's name or their Steam/EOS id. */
export function playerMatchesWatchlist(event: PlayerConnectionEvent, watchlist: WatchedPlayerAlert[]): boolean {
  return watchlist.some(
    (w) => w.value.toLowerCase() === event.playerName.toLowerCase() || w.value.toLowerCase() === event.uniqueNetId.toLowerCase()
  )
}

export function stopPlayerJoinAlertWatch(profileId: string): void {
  const fn = stopFns.get(profileId)
  if (fn) {
    fn()
    stopFns.delete(profileId)
  }
}

/** Starts watching profile.installDir's log for join lines, if the feature's enabled in
 *  Settings (a global toggle, unlike playerBackupWatch's per-profile one - there's no
 *  reason to pick and choose which servers to be alerted on, the watched player could show
 *  up on any of them). Safe to call for an already-running server adopted at app startup. */
export function startPlayerJoinAlertWatch(profile: ServerProfile): void {
  stopPlayerJoinAlertWatch(profile.id)
  if (!getSettings().discordBotPlayerAlertEnabled) return

  stopFns.set(
    profile.id,
    watchPlayerConnectionEvents(profile.installDir, (event) => {
      if (event.type !== 'joined') return
      if (!playerMatchesWatchlist(event, listWatchedPlayers())) return
      notifyPlayerJoin(profile.name, event.playerName, event.uniqueNetId)
    })
  )
}

/** Re-evaluates the watch for a profile right after Settings is saved, so toggling the
 *  alert on/off (or editing the watchlist) takes effect immediately on already-running
 *  servers instead of only on their next restart. No-op if the server isn't running. */
export function syncPlayerJoinAlertWatch(profile: ServerProfile): void {
  if (!isRunning(profile.id)) return
  if (getSettings().discordBotPlayerAlertEnabled) startPlayerJoinAlertWatch(profile)
  else stopPlayerJoinAlertWatch(profile.id)
}

/** Re-syncs every currently-running ARK profile at once - called from the Settings save
 *  handler, since this feature's toggle lives in Settings rather than per-profile. */
export function syncAllPlayerJoinAlertWatches(): void {
  for (const profile of listProfiles()) syncPlayerJoinAlertWatch(profile)
}

/** Starts/stops the per-server watch alongside the server's own lifecycle - wired off
 *  serverEvents so it self-cleans on a crash too, not just an explicit Stop/Kill. Call once
 *  at app startup. */
export function registerPlayerJoinAlertWatch(): void {
  serverEvents.on('status', (status: ServerStatus) => {
    if (status.state === 'starting') {
      const profile = getProfile(status.profileId)
      if (profile) startPlayerJoinAlertWatch(profile)
    } else if (status.state === 'stopped' || status.state === 'error') {
      stopPlayerJoinAlertWatch(status.profileId)
    }
  })
}
