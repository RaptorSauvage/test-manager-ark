import type { ServerProfile, ServerStatus } from '@shared/types'
import { isRunning, serverEvents } from './serverProcess'
import { getProfile, getSettings, listProfiles, recordPlayerSession } from '../store'
import { watchPlayerConnectionEvents } from './playerConnectionWatcher'

const stopFns = new Map<string, () => void>()
// profileId -> uniqueNetId -> when that still-open session started, plus the name it joined
// under (ARK lets a player rename between sessions, so this is the name a leave event's own
// matching joined event actually saw, not whatever name the leave line happens to carry).
const openSessions = new Map<string, Map<string, { joinedAt: number; playerName: string }>>()

export function stopPlayerActivityWatch(profileId: string): void {
  const fn = stopFns.get(profileId)
  if (fn) {
    fn()
    stopFns.delete(profileId)
  }
  // Any session still open when the server stops is dropped rather than guessed-closed -
  // there's no real "left" event to time it against, and a wrong number is worse than a
  // missing one for a playtime total.
  openSessions.delete(profileId)
}

/** Starts watching profile.installDir's log for join/leave lines, if the feature's enabled
 *  in Settings (a global toggle, same reasoning as playerJoinAlertWatch.ts - every server in
 *  the cluster is tracked, not a per-profile choice). Safe to call for an already-running
 *  server adopted at app startup. */
export function startPlayerActivityWatch(profile: ServerProfile): void {
  stopPlayerActivityWatch(profile.id)
  if (!getSettings().playerActivityTrackingEnabled) return

  const sessions = new Map<string, { joinedAt: number; playerName: string }>()
  openSessions.set(profile.id, sessions)

  stopFns.set(
    profile.id,
    watchPlayerConnectionEvents(profile.installDir, (event) => {
      if (event.type === 'joined') {
        // A join line for an id that's already open (missed its leave, e.g. a crash) just
        // restarts the clock rather than stacking a second concurrent session for it.
        sessions.set(event.uniqueNetId, { joinedAt: Date.now(), playerName: event.playerName })
        return
      }
      const open = sessions.get(event.uniqueNetId)
      // A leave with no matching open join (e.g. they were already connected when this watch
      // started) has nothing to time against - silently skipped, not guessed.
      if (!open) return
      sessions.delete(event.uniqueNetId)
      recordPlayerSession(profile.id, event.uniqueNetId, open.playerName, open.joinedAt, Date.now())
    })
  )
}

/** Re-evaluates the watch for a profile right after Settings is saved, so toggling tracking
 *  on/off takes effect immediately on already-running servers. No-op if not running. */
export function syncPlayerActivityWatch(profile: ServerProfile): void {
  if (!isRunning(profile.id)) return
  if (getSettings().playerActivityTrackingEnabled) startPlayerActivityWatch(profile)
  else stopPlayerActivityWatch(profile.id)
}

/** Re-syncs every currently-running ARK profile at once - called from the Settings save
 *  handler, since this feature's toggle lives in Settings rather than per-profile. */
export function syncAllPlayerActivityWatches(): void {
  for (const profile of listProfiles()) syncPlayerActivityWatch(profile)
}

/** Starts/stops the per-server watch alongside the server's own lifecycle - wired off
 *  serverEvents so it self-cleans on a crash too, not just an explicit Stop/Kill. Call once
 *  at app startup. */
export function registerPlayerActivityWatch(): void {
  serverEvents.on('status', (status: ServerStatus) => {
    if (status.state === 'starting') {
      const profile = getProfile(status.profileId)
      if (profile) startPlayerActivityWatch(profile)
    } else if (status.state === 'stopped' || status.state === 'error') {
      stopPlayerActivityWatch(status.profileId)
    }
  })
}
