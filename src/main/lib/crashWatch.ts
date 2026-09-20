import type { ServerProfile, ServerRunState, ServerStatus } from '@shared/types'
import { getProfile } from '../store'
import { isRunning, serverEvents } from './serverProcess'
import { logManagerEvent, newTaskId } from './managerLog'

/** How long to wait after a confirmed crash before restarting - gives a moment for
 *  whatever caused the crash (a bad save, a port conflict, antivirus, ...) to clear before
 *  immediately trying again. */
const RESTART_DELAY_MS = 15000

const lastKnownState = new Map<string, ServerRunState>()
const pendingRestarts = new Map<string, NodeJS.Timeout>()

/** Cancels a pending auto-restart for this profile, if one is waiting out its delay - a
 *  no-op otherwise. Deliberate actions (serverActions.ts's doStop/doKill/doRestartServer)
 *  call this themselves before touching the process, on top of the fact that none of them
 *  can trigger a new one in the first place (see handleStatusForCrashWatch below): belt and
 *  suspenders for a safety feature, rather than leaning solely on state-transition timing. */
export function cancelPendingCrashRestart(profileId: string): void {
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
  startServer: (profile: ServerProfile) => void,
  lookupProfile: (id: string) => ServerProfile | undefined = getProfile
): void {
  const previous = lastKnownState.get(status.profileId)
  lastKnownState.set(status.profileId, status.state)

  if (status.state !== 'stopped') {
    // Anything other than 'stopped' means the server is back under control by some other
    // means (manually restarted, adopted again, ...) - a pending auto-restart from an
    // earlier crash no longer applies.
    cancelPendingCrashRestart(status.profileId)
    return
  }

  if (previous !== 'running') return // deliberate stop/kill/restart/update - not a crash

  const profile = lookupProfile(status.profileId)
  if (!profile || !profile.crashWatchEnabled) return

  cancelPendingCrashRestart(status.profileId)
  const taskId = newTaskId('crash-watch')
  const taskLabel = `Anti-Crash Watchdog — ${profile.name}`
  logManagerEvent(taskId, taskLabel, `Crash detected - restarting in ${RESTART_DELAY_MS / 1000}s...`, 'error')
  const timer = setTimeout(() => {
    pendingRestarts.delete(status.profileId)
    const current = lookupProfile(status.profileId)
    if (!current || !current.crashWatchEnabled) {
      logManagerEvent(taskId, taskLabel, 'Restart cancelled - watchdog was disabled before it fired.')
      return
    }
    if (isRunning(status.profileId)) {
      logManagerEvent(taskId, taskLabel, 'Restart skipped - server was already started by something else.')
      return
    }
    console.warn(`${current.name}: restarting automatically after an unexpected crash.`)
    logManagerEvent(taskId, taskLabel, 'Restarting...')
    startServer(current)
  }, RESTART_DELAY_MS)
  pendingRestarts.set(status.profileId, timer)
}

/** `startServer` is passed in (rather than imported from serverActions.ts directly) so this
 *  module has no dependency on it - serverActions.ts imports cancelPendingCrashRestart from
 *  here, and a static import cycle between the two would otherwise result. */
export function registerCrashWatch(startServer: (profile: ServerProfile) => void): void {
  serverEvents.on('status', (status: ServerStatus) => handleStatusForCrashWatch(status, startServer))
}
