/**
 * PoC Node sidecar: a persistent child process the Rust shell spawns and talks to over
 * newline-delimited JSON on stdin/stdout, standing in for what a real migration's sidecar
 * would look like - the actual application logic (imported below from the real
 * src/main/store.ts, completely unmodified) runs exactly as it does today, in Node; only the
 * transport (Electron's ipcMain <-> this process's stdin/stdout) and the host (Electron's own
 * Node integration <-> a plain `node` child process spawned by Rust) are different.
 */
import readline from 'node:readline'
import { listProfiles } from '../../src/main/store'

interface RpcRequest {
  id: number
  method: string
}

type RpcResponse = { id: number; result: unknown } | { id: number; error: string }

function send(response: RpcResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n')
}

const methods: Record<string, () => unknown> = {
  'profiles.list': () => listProfiles()
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
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
    send({ id: request.id, result: handler() })
  } catch (err) {
    send({ id: request.id, error: (err as Error).message })
  }
})

// Tells the Rust side the sidecar is up and its stdio pipes are ready to receive requests -
// spawning a child process and it actually being ready to read stdin aren't the same instant.
console.error('sidecar: ready')
