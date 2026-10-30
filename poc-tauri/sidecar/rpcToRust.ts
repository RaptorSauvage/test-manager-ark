/**
 * Everything so far only went one way: Rust calls the sidecar, the sidecar answers or pushes
 * events, both over the same stdout pipe. Real lib files that call Electron's `shell.*`
 * (systemFolders.ts, backup.ts, ...) need the opposite direction too - only the Rust shell can
 * make the actual native "open this in the system file manager" call, so the sidecar has to
 * ask it to and wait for a real answer, not just fire-and-forget.
 *
 * Reuses the exact same bidirectional stdin/stdout pipe rather than opening a second channel:
 * an outgoing request is a push-event-shaped line (`{event: 'shell-request', data: {id,
 * method, params}}`, since Tauri's own event-name rules already make 'shell-request' a safe,
 * reserved-looking name no real push event would collide with) and Rust answers with a plain
 * `{id, result}`/`{id, error}` line on stdin - indistinguishable on the wire from a response to
 * an RPC call *Rust* initiated, except it uses its own id counter/pending map in the other
 * direction. sidecar.ts's own stdin line handler tells the two apart by one rule: a line with
 * a "method" field is a command from Rust; a line without one is a response to one of this
 * module's own outgoing requests, routed here via `resolveRustResponse`.
 */

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void }

const pending = new Map<number, Pending>()
let nextId = 1

export function send(message: unknown): void {
  process.stdout.write(JSON.stringify(message) + '\n')
}

export function callRust(method: string, params: unknown): Promise<unknown> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ event: 'shell-request', data: { id, method, params } })
  })
}

/** Returns false if `id` doesn't match any outstanding `callRust()` - lets the caller tell a
 *  genuinely unmatched response apart from one that's just arriving late. */
export function resolveRustResponse(id: number, result: unknown, error: string | undefined): boolean {
  const entry = pending.get(id)
  if (!entry) return false
  pending.delete(id)
  if (error !== undefined) entry.reject(new Error(error))
  else entry.resolve(result)
  return true
}
