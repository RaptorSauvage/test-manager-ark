/**
 * PoC Node sidecar: a persistent child process the Rust shell spawns and talks to over
 * newline-delimited JSON on stdin/stdout, standing in for what a real migration's sidecar
 * would look like - the actual application logic (imported below from the real
 * src/main/store.ts, completely unmodified) runs exactly as it does today, in Node; only the
 * transport (Electron's ipcMain <-> this process's stdin/stdout) and the host (Electron's own
 * Node integration <-> a plain `node` child process spawned by Rust) are different.
 *
 * Two message shapes travel over stdout: a response (has "id", answers one specific request)
 * and a push event (has "event" instead, unsolicited - the Rust side forwards these to the
 * webview as ordinary Tauri events). profiles.list/profiles.save below are real calls into
 * store.ts; the 'profiles-changed' push wraps store.ts's own `profileEvents` EventEmitter,
 * unmodified - proving a live update (the kind every console/status view in the real app
 * needs) can reach the webview without the webview having asked for it first.
 *
 * log.record/'manager-log-entry' below proves the same push mechanism carries a SECOND,
 * independent event source too (lib/managerLog.ts's own `managerLogEvents`, a different real
 * subsystem backed by a JSONL file rather than electron-store) - multiplexed over the exact
 * same stdout pipe by event name, which is the shape a real migration needs for every one of
 * the real app's several independent live-update channels (console output, server status,
 * manager log, ...), not just one.
 */
import readline from 'node:readline'
import { listProfiles, saveProfile, profileEvents } from '../../src/main/store'
import { logManagerEvent, newTaskId, managerLogEvents } from '../../src/main/lib/managerLog'
import type { ServerProfile } from '../../shared/types'

interface RpcRequest {
  id: number
  method: string
  params?: unknown
}

type RpcResponse = { id: number; result: unknown } | { id: number; error: string }
type PushEvent = { event: string; data: unknown }

function send(message: RpcResponse | PushEvent): void {
  process.stdout.write(JSON.stringify(message) + '\n')
}

const methods: Record<string, (params: unknown) => unknown> = {
  'profiles.list': () => listProfiles(),
  // No schema validation here on purpose - store.ts itself does none either (TS types are
  // compile-time only), and this PoC is about proving the write path reaches the real
  // function and its real side effects (persisting to disk, emitting profileEvents), not
  // about adding input validation a real migration would still need to design properly.
  'profiles.save': (params) => saveProfile(params as ServerProfile),
  // Real write into lib/managerLog.ts's own JSONL file, through the real logManagerEvent -
  // proves a second, differently-shaped real subsystem (file-backed, async persistence)
  // behaves the same way through this sidecar as the in-memory-then-electron-store one above.
  'log.record': async (params) => {
    const message = typeof params === 'string' ? params : 'Test entry from the Tauri PoC sidecar'
    // logManagerEvent resolves void - the RPC response still needs a concrete result value
    // (not undefined, which JSON.stringify would drop, leaving neither "result" nor "error"
    // in the line Rust reads) so { ok: true } stands in for "the write finished".
    await logManagerEvent(newTaskId('poc'), 'Tauri PoC', message, 'info')
    return { ok: true }
  }
}

// Tauri's own event names only accept alphanumerics, '-', '/', ':', '_' - found by actually
// running this against a real Tauri app.emit() call, not from reading the docs - 'profiles-
// changed' here, not 'profiles.changed' matching the RPC method naming below. Same for
// 'manager-log-entry' vs. the real app's own 'log' event name on managerLogEvents.
profileEvents.on('changed', (profiles) => send({ event: 'profiles-changed', data: profiles }))
managerLogEvents.on('log', (entry) => send({ event: 'manager-log-entry', data: entry }))

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  let request: RpcRequest
  try {
    request = JSON.parse(line)
  } catch (err) {
    console.error('sidecar: failed to parse request line:', line, err)
    return
  }
  const handler = methods[request.method]
  if (!handler) {
    send({ id: request.id, error: `Unknown method "${request.method}"` })
    return
  }
  try {
    const result = await handler(request.params)
    send({ id: request.id, result })
  } catch (err) {
    send({ id: request.id, error: (err as Error).message })
  }
})

// Tells the Rust side the sidecar is up and its stdio pipes are ready to receive requests -
// spawning a child process and it actually being ready to read stdin aren't the same instant.
console.error('sidecar: ready')
