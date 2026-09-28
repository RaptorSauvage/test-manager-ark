import fs from 'node:fs'
import type { ServerProfile, ServerRunState, ServerStatus } from '@shared/types'
import { getProfile } from '../store'
import { getStatus, serverEvents, getLogFilePath } from './serverProcess'

const lastKnownState = new Map<string, ServerRunState>()
const pendingChecks = new Map<string, NodeJS.Timeout>()
const runningWatches = new Map<string, NodeJS.Timeout>()

/** Cancels a pending zombie check for this profile, if one is waiting out its timeout - a
 *  no-op otherwise. */
export function cancelPendingZombieCheck(profileId: string): void {
  const timer = pendingChecks.get(profileId)
  if (timer) {
    clearTimeout(timer)
    pendingChecks.delete(profileId)
  }
}

/** Stops the running-phase log-activity watch (see armRunningZombieWatch) for this profile,
 *  if one is active - a no-op otherwise. */
export function cancelRunningZombieWatch(profileId: string): void {
  const timer = runningWatches.get(profileId)
  if (timer) {
    clearInterval(timer)
    runningWatches.delete(profileId)
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

/** The log file's current size in bytes, or null if it can't be read right now (doesn't
 *  exist yet, a permission error, a transient race with log rotation, ...). null is never
 *  treated as zombie evidence by armRunningZombieWatch below - only an actually-unchanged
 *  size counts, so a stat that merely fails can't cause a false-positive kill. */
function defaultGetLogSize(installDir: string): number | null {
  try {
    return fs.statSync(getLogFilePath(installDir)).size
  } catch {
    return null
  }
}

/**
 * ARK: Survival Evolved-only: once a profile reaches 'running', periodically checks whether
 * its own log file is still growing. A real report showed it getting stuck in a frozen world
 * tick - the OS process still alive (sometimes even still answering RCON), but the game loop
 * itself hung - which a healthy server never does even with nobody connected, since it keeps
 * logging *something* on its own (autosaves, engine housekeeping, ...). If the log hasn't
 * grown at all for a full `zombieDetectionTimeoutMinutes`, that's treated the same as a
 * startup-stuck zombie: killed, then optionally restarted.
 *
 * ARK: Survival Ascended doesn't get this watch - the existing startup-stuck check below
 * already covers the zombie scenario actually reported for it, and adding a log-activity
 * check for it too would be an unverified, unrequested behavior change.
 */
function armRunningZombieWatch(
  profileId: string,
  killServer: (profileId: string) => void,
  startServer: (profile: ServerProfile) => void,
  lookupProfile: (id: string) => ServerProfile | undefined,
  getLogSize: (installDir: string) => number | null,
  checkIntervalMs: number
): void {
  cancelRunningZombieWatch(profileId)
  const initialProfile = lookupProfile(profileId)
  // Seeded synchronously at arm time (rather than waiting for the first tick to establish a
  // baseline) so `zombieDetectionTimeoutMinutes` means what it says - N minutes from now,
  // not N minutes plus however long the first check interval happens to take to establish
  // a starting point.
  let lastSize: number | null = initialProfile ? getLogSize(initialProfile.installDir) : null
  let lastGrowthAt = Date.now()

  const timer = setInterval(() => {
    const profile = lookupProfile(profileId)
    if (!profile || !profile.zombieDetectionEnabled || profile.game !== 'ark-evolved') {
      cancelRunningZombieWatch(profileId)
      return
    }
    if (getStatus(profileId).state !== 'running') {
      cancelRunningZombieWatch(profileId)
      return
    }

    const size = getLogSize(profile.installDir)
    if (size === null) return // can't tell right now - never counted as zombie evidence

    if (lastSize === null || size !== lastSize) {
      lastSize = size
      lastGrowthAt = Date.now()
      return
    }

    const timeoutMs = Math.max(1, profile.zombieDetectionTimeoutMinutes) * 60_000
    if (Date.now() - lastGrowthAt < timeoutMs) return

    console.warn(
      `${profile.name}: its own log hasn't grown at all in over ${profile.zombieDetectionTimeoutMinutes} minute(s) while running - killing it as a zombie.`
    )
    cancelRunningZombieWatch(profileId)
    const stopped = profile.zombieDetectionAutoRestart ? waitForStopped(profileId) : null
    killServer(profileId)

    if (!stopped) return
    void stopped.then(() => {
      const latest = lookupProfile(profileId)
      if (latest && latest.zombieDetectionEnabled && latest.zombieDetectionAutoRestart) startServer(latest)
    })
  }, checkIntervalMs)

  runningWatches.set(profileId, timer)
}

/**
 * Zombie detection has two independent parts:
 *
 * 1. Startup-stuck (both games): active only during the `starting` phase - armed the moment
 *    a profile enters `starting`, disarmed the instant it leaves for any reason (reaching
 *    `running`, or otherwise). If it's still `starting` once `zombieDetectionTimeoutMinutes`
 *    elapses, the process is killed as stuck in an endless startup loop, optionally followed
 *    by an automatic restart attempt.
 * 2. Running-frozen (ARK: Survival Evolved only): active for as long as a profile stays
 *    `running` - see armRunningZombieWatch above.
 *
 * Opt-in per profile via `zombieDetectionEnabled`, independent from every other profile. The
 * enabled flag, the timeout, and the auto-restart choice are all re-checked right before a
 * kill actually fires (not just at arming time), so changing any of them during the wait
 * takes effect immediately.
 */
export function handleStatusForZombieDetection(
  status: ServerStatus,
  killServer: (profileId: string) => void,
  startServer: (profile: ServerProfile) => void,
  lookupProfile: (id: string) => ServerProfile | undefined = getProfile,
  getLogSize: (installDir: string) => number | null = defaultGetLogSize,
  runningCheckIntervalMs = 60_000
): void {
  const previous = lastKnownState.get(status.profileId)
  lastKnownState.set(status.profileId, status.state)

  if (status.state === 'running') {
    if (previous !== 'running') {
      cancelPendingZombieCheck(status.profileId) // the startup-stuck check no longer applies
      const profile = lookupProfile(status.profileId)
      if (profile && profile.zombieDetectionEnabled && profile.game === 'ark-evolved') {
        armRunningZombieWatch(status.profileId, killServer, startServer, lookupProfile, getLogSize, runningCheckIntervalMs)
      }
    }
    return
  }

  cancelRunningZombieWatch(status.profileId)

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
