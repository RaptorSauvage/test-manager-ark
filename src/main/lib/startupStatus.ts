import { EventEmitter } from 'node:events'

/**
 * Tracks whether app.whenReady()'s own startup sequence (main/index.ts) has fully finished -
 * re-attaching to already-running servers, starting the Web Dashboard, arming the Event
 * Scheduler, auto-starting servers, and everything else in that chain - not just whether the
 * first profiles/settings IPC calls have resolved, which can happen much earlier (that chain
 * now yields back to the event loop between steps - see yieldToEventLoop in main/index.ts -
 * so a renderer polling individual endpoints can get real data back well before the rest of
 * startup is actually done). The renderer's own loading screen waits on this too, via
 * ipc/startupStatus.ts, so it covers the whole startup instead of disappearing early onto a
 * dashboard that's still settling in behind it.
 */
let complete = false
export const startupStatusEvents = new EventEmitter()

export function isStartupComplete(): boolean {
  return complete
}

export function markStartupComplete(): void {
  if (complete) return
  complete = true
  startupStatusEvents.emit('complete')
}
