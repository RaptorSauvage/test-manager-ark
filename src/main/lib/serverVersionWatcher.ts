import type { ServerRunState, ServerStatus } from '@shared/types'
import { serverEvents } from './serverProcess'
import { getProfile } from '../store'
import { getGameVersion, setCachedGameVersion } from './serverVersion'

const lastKnownState = new Map<string, ServerRunState>()

/**
 * Refreshes the cached game version the moment a server transitions to 'running' - a
 * fresh start (once the startup-complete marker fires - see serverProcess.ts) or an
 * already-running server adopted at Manager launch. Deliberately edge-triggered
 * (previous state -> running), not level-triggered, so the routine 5s status ticks
 * monitor.ts emits for a server that's already running don't re-read the log file on
 * every single one - just once per actual start.
 */
export function handleStatusForVersionTracking(
  status: ServerStatus,
  lookupProfile: (id: string) => { installDir: string } | undefined = getProfile,
  fetchVersion: (installDir: string) => Promise<string | null> = getGameVersion,
  storeVersion: (profileId: string, version: string) => void = setCachedGameVersion
): void {
  const previous = lastKnownState.get(status.profileId)
  lastKnownState.set(status.profileId, status.state)
  if (status.state !== 'running' || previous === 'running') return

  const profile = lookupProfile(status.profileId)
  if (!profile) return
  fetchVersion(profile.installDir).then((version) => {
    if (version) storeVersion(status.profileId, version)
  })
}

export function registerServerVersionWatcher(): void {
  serverEvents.on('status', (status: ServerStatus) => handleStatusForVersionTracking(status))
}
