import type { ServerProfile, ServerStatus } from '@shared/types'
import { isRunning, serverEvents } from './serverProcess'
import { getProfile } from '../store'
import { watchPlayerConnectionEvents } from './playerConnectionWatcher'
import { backupPlayerProfile } from './playerBackup'

const stopFns = new Map<string, () => void>()

export function stopPlayerBackupWatch(profileId: string): void {
  const fn = stopFns.get(profileId)
  if (fn) {
    fn()
    stopFns.delete(profileId)
  }
}

/** Starts watching profile.installDir's log for join/leave lines, if the toggle is on.
 *  Safe to call for an already-running server adopted at app startup, not just one just
 *  spawned by this session. */
export function startPlayerBackupWatch(profile: ServerProfile): void {
  stopPlayerBackupWatch(profile.id)
  if (!profile.playerProfileBackupEnabled) return

  stopFns.set(
    profile.id,
    watchPlayerConnectionEvents(profile.installDir, (event) => {
      void backupPlayerProfile(profile, event).catch((err: Error) => {
        console.error(`Player profile backup failed for ${event.playerName}:`, err.message)
      })
    })
  )
}

/**
 * Re-evaluates the watch for a profile right after its settings are saved, so toggling
 * "Back up player profiles on join/leave" (or changing the retention count) takes effect
 * immediately on an already-running server instead of only on its next restart.
 * No-op if the server isn't currently running - the normal start/stop wiring below
 * already covers that case.
 */
export function syncPlayerBackupWatch(profile: ServerProfile): void {
  if (!isRunning(profile.id)) return
  if (profile.playerProfileBackupEnabled) startPlayerBackupWatch(profile)
  else stopPlayerBackupWatch(profile.id)
}

/** Starts/stops the per-server player-connection log watch alongside the server's own
 *  lifecycle - wired off serverEvents so it self-cleans on a crash, not just an explicit
 *  Stop/Kill. Call once at app startup. */
export function registerPlayerBackupWatch(): void {
  serverEvents.on('status', (status: ServerStatus) => {
    if (status.state === 'starting') {
      const profile = getProfile(status.profileId)
      if (profile) startPlayerBackupWatch(profile)
    } else if (status.state === 'stopped' || status.state === 'error') {
      stopPlayerBackupWatch(status.profileId)
    }
  })
}
