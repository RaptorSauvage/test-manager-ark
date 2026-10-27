import { logManagerEvent, newTaskId } from './managerLog'

/** How often the watchdog checks in - small enough to catch even a moderate freeze without
 *  waiting too long to report it, not so small the check itself adds meaningful overhead
 *  (one timer callback and a Date.now() comparison, every tick). */
const CHECK_INTERVAL_MS = 200

/** A gap since the last tick this far past CHECK_INTERVAL_MS isn't normal scheduling jitter
 *  (GC pauses, the OS briefly deprioritizing the process, ...) - something genuinely blocked
 *  the main process's event loop for roughly this long. */
const BLOCKED_THRESHOLD_MS = 500

/**
 * Detects an Electron main-process freeze after the fact, regardless of its cause. A timer is
 * scheduled every CHECK_INTERVAL_MS; if the actual gap since the previous tick comes back much
 * longer than that, nothing else could have run in between either - not an IPC call, not a
 * window repaint, nothing - so the whole app was genuinely frozen for roughly that long, no
 * matter what caused it. Logs the measured duration (to the Manager Log, so it's visible in
 * the app itself and persists across restarts) once the block ends and this timer finally gets
 * to run again.
 *
 * Several real freeze reports against this app were each chased down by guessing a specific
 * synchronous call on a specific code path (a sync fs read on Manager startup, a sync archive
 * write on every console line, a sync Manager Log write on every Start/Stop/Kill, ...) - each
 * fix was real, but every one of them required a guess first. This instead gives an objective
 * timestamp and duration for *any* main-process freeze the next time one happens, whether or
 * not it's a cause already known about - turning "it still freezes sometimes" into a concrete
 * "it was blocked for ~Ns at HH:MM:SS" to actually chase down, visible right in the Manager Log
 * page without needing DevTools or a separate debug build.
 */
export function startMainThreadWatchdog(): void {
  let last = Date.now()
  const interval = setInterval(() => {
    const now = Date.now()
    const gap = now - last
    last = now
    if (gap < BLOCKED_THRESHOLD_MS) return
    logManagerEvent(
      newTaskId('perf-watchdog'),
      'Performance',
      `The Manager's own window was unresponsive for about ${(gap / 1000).toFixed(1)}s.`,
      'error'
    )
  }, CHECK_INTERVAL_MS)
  // Never on its own keeps the process alive - purely observational, same reasoning as any
  // other background interval in this app that isn't itself a reason for the app to keep
  // running.
  interval.unref()
}
