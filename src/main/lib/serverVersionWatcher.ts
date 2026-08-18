import type { ServerProfile, ServerRunState, ServerStatus } from '@shared/types'
import { serverEvents } from './serverProcess'
import { getProfile } from '../store'
import { getGameVersion, setCachedGameVersion } from './serverVersion'

const lastKnownState = new Map<string, ServerRunState>()

/** States worth re-checking the version on entering - covers the whole start/stop/update
 *  lifecycle. 'error' is deliberately left out - nothing about a failed start would have
 *  changed what's in the log. */
const TRACKED_STATES: ReadonlySet<ServerRunState> = new Set([
  'running',
  'starting',
  'stopping',
  'updating',
  'stopped'
])

async function refreshGameVersion(
  profileId: string,
  installDir: string,
  fetchVersion: (installDir: string) => Promise<string | null>,
  storeVersion: (profileId: string, version: string) => void
): Promise<void> {
  const version = await fetchVersion(installDir)
  if (version) storeVersion(profileId, version)
}

/**
 * Refreshes the cached game version every time a server's status changes into one of
 * TRACKED_STATES - covers a fresh start, a stop, an update, and everything in between,
 * not just the moment it becomes fully 'running'. Deliberately edge-triggered (the state
 * actually changed), not level-triggered, so the routine 5s status ticks monitor.ts emits
 * for a server that's already running don't re-read the log file on every single one -
 * just once per actual transition.
 */
export function handleStatusForVersionTracking(
  status: ServerStatus,
  lookupProfile: (id: string) => { installDir: string } | undefined = getProfile,
  fetchVersion: (installDir: string) => Promise<string | null> = getGameVersion,
  storeVersion: (profileId: string, version: string) => void = setCachedGameVersion
): void {
  const previous = lastKnownState.get(status.profileId)
  lastKnownState.set(status.profileId, status.state)
  if (status.state === previous || !TRACKED_STATES.has(status.state)) return

  const profile = lookupProfile(status.profileId)
  if (!profile) return
  void refreshGameVersion(status.profileId, profile.installDir, fetchVersion, storeVersion)
}

/** Checks every profile once at Manager startup, regardless of whether it's currently
 *  running - a stopped server's log from its last run may still have a usable version
 *  line, so there's no reason to wait for its next start just to show something. */
export function checkAllGameVersionsOnStartup(
  profiles: ServerProfile[],
  fetchVersion: (installDir: string) => Promise<string | null> = getGameVersion,
  storeVersion: (profileId: string, version: string) => void = setCachedGameVersion
): void {
  for (const profile of profiles) {
    void refreshGameVersion(profile.id, profile.installDir, fetchVersion, storeVersion)
  }
}

export function registerServerVersionWatcher(): void {
  serverEvents.on('status', (status: ServerStatus) => handleStatusForVersionTracking(status))
}
