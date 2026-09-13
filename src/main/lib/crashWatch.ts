import type { ServerProfile, ServerRunState, ServerStatus } from '@shared/types'
import { getProfile } from '../store'
import { isRunning, serverEvents } from './serverProcess'
import { doStartServer } from './serverActions'

/** How long to wait after a confirmed crash before restarting - gives a moment for
 *  whatever caused the crash (a bad save, a port conflict, antivirus, ...) to clear before
 *  immediately trying again. */
const RESTART_DELAY_MS = 15000

const lastKnownState = new Map<string, ServerRunState>()
const pendingRestarts = new Map<string, NodeJS.Timeout>()

function cancelPendingRestart(profileId: string): void {
  const timer = pendingRestarts.get(profileId)
  if (timer) {
    clearTimeout(timer)
    pendingRestarts.delete(profileId)
  }
}

/**
 * Anti-crash watchdog: restarts a server RESTART_DELAY_MS after it's found to have gone
 * straight from `running` to `stopped` - a transition that only happens for a genuinely
 * confirmed crash, thanks to serverProcess.ts's own RCON re-verification before ever
 * finalizing a status as `stopped` (see handleUnexpectedExit). A deliberate Stop, Kill,
 * Restart, Update, or scheduled restart always sets `stopping`/`restarting` before ever
 * touching the process, so none of those are ever mistaken for a crash here - there's
 * nothing to special-case per action.
 *
 * Opt-in per profile via `crashWatchEnabled`, independent from every other profile (its own
 * entry in `pendingRestarts`/`lastKnownState`, keyed by profile id). The flag is checked
 * again right before the restart actually fires (not just at detection time), so turning it
 * off during the wait cancels the pending restart too.
 */
export function handleStatusForCrashWatch(
  status: ServerStatus,
  lookupProfile: (id: string) => ServerProfile | undefined = getProfile,
  startServer: (profile: ServerProfile) => void = doStartServer
): void {
  const previous = lastKnownState.get(status.profileId)
  lastKnownState.set(status.profileId, status.state)

  if (status.state !== 'stopped') {
    // Anything other than 'stopped' means the server is back under control by some other
    // means (manually restarted, adopted again, ...) - a pending auto-restart from an
    // earlier crash no longer applies.
    cancelPendingRestart(status.profileId)
    return
  }

  if (previous !== 'running') return // deliberate stop/kill/restart/update - not a crash

  const profile = lookupProfile(status.profileId)
  if (!profile || !profile.crashWatchEnabled) return

  cancelPendingRestart(status.profileId)
  const timer = setTimeout(() => {
    pendingRestarts.delete(status.profileId)
    const current = lookupProfile(status.profileId)
    if (!current || !current.crashWatchEnabled) return
    if (isRunning(status.profileId)) return
    console.warn(`${current.name}: restarting automatically after an unexpected crash.`)
    startServer(current)
  }, RESTART_DELAY_MS)
  pendingRestarts.set(status.profileId, timer)
}

export function registerCrashWatch(): void {
  serverEvents.on('status', (status: ServerStatus) => handleStatusForCrashWatch(status))
}
