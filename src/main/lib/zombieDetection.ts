import type { ServerProfile, ServerRunState, ServerStatus } from '@shared/types'
import { getProfile } from '../store'
import { getStatus, serverEvents } from './serverProcess'

const lastKnownState = new Map<string, ServerRunState>()
const pendingChecks = new Map<string, NodeJS.Timeout>()

/** Cancels a pending zombie check for this profile, if one is waiting out its timeout - a
 *  no-op otherwise. */
export function cancelPendingZombieCheck(profileId: string): void {
  const timer = pendingChecks.get(profileId)
  if (timer) {
    clearTimeout(timer)
    pendingChecks.delete(profileId)
  }
}

/** Resolves once this profile is next seen as `stopped` - used to sequence an auto-restart
 *  after killing a zombie without racing serverProcess.ts's own async teardown (the kill
 *  signal itself resolves before the OS process has actually exited). */
function waitForStopped(profileId: string): Promise<void> {
  return new Promise((resolve) => {
    const onStatus = (status: ServerStatus): void => {
      if (status.profileId !== profileId || status.state !== 'stopped') return
      serverEvents.off('status', onStatus)
      resolve()
    }
    serverEvents.on('status', onStatus)
  })
}

/**
 * Zombie detection: active only during the `starting` phase - armed the moment a profile
 * enters `starting`, and disarmed the instant it leaves `starting` for any reason (reaching
 * `running`, or otherwise). If it's still `starting` once `zombieDetectionTimeoutMinutes`
 * elapses, the process is killed as a zombie stuck in an endless startup loop, optionally
 * followed by an automatic restart attempt.
 *
 * Opt-in per profile via `zombieDetectionEnabled`, independent from every other profile.
 * Both the enabled flag and the auto-restart choice are re-checked right before the kill
 * actually fires (not just at arming time), so changing either during the wait takes effect
 * immediately.
 */
export function handleStatusForZombieDetection(
  status: ServerStatus,
  killServer: (profileId: string) => void,
  startServer: (profile: ServerProfile) => void,
  lookupProfile: (id: string) => ServerProfile | undefined = getProfile
): void {
  const previous = lastKnownState.get(status.profileId)
  lastKnownState.set(status.profileId, status.state)

  if (status.state !== 'starting') {
    // Left 'starting' for any reason (running, stopped, error, ...) - nothing left to watch.
    cancelPendingZombieCheck(status.profileId)
    return
  }

  if (previous === 'starting') return // already armed for this starting phase

  const profile = lookupProfile(status.profileId)
  if (!profile || !profile.zombieDetectionEnabled) return

  cancelPendingZombieCheck(status.profileId)
  const timeoutMs = Math.max(1, profile.zombieDetectionTimeoutMinutes) * 60_000
  const timer = setTimeout(() => {
    pendingChecks.delete(status.profileId)
    const current = lookupProfile(status.profileId)
    if (!current || !current.zombieDetectionEnabled) return
    if (getStatus(status.profileId).state !== 'starting') return // already resolved

    console.warn(
      `${current.name}: stuck in 'starting' for over ${current.zombieDetectionTimeoutMinutes} minute(s) - killing it as a zombie.`
    )
    const stopped = current.zombieDetectionAutoRestart ? waitForStopped(status.profileId) : null
    killServer(status.profileId)

    if (!stopped) return
    void stopped.then(() => {
      const latest = lookupProfile(status.profileId)
      if (latest && latest.zombieDetectionEnabled && latest.zombieDetectionAutoRestart) startServer(latest)
    })
  }, timeoutMs)
  pendingChecks.set(status.profileId, timer)
}

/** `killServer`/`startServer` are passed in (rather than imported from serverActions.ts
 *  directly) for the same reason as crashWatch.ts's registerCrashWatch - keeps this module
 *  free of any dependency on serverActions.ts. */
export function registerZombieDetection(
  killServer: (profileId: string) => void,
  startServer: (profile: ServerProfile) => void
): void {
  serverEvents.on('status', (status: ServerStatus) => handleStatusForZombieDetection(status, killServer, startServer))
}
