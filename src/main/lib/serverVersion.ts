import { spawn } from 'node:child_process'

/**
 * Parses the human-readable game version (e.g. "92.28") out of the ARK dedicated
 * server's own console window title, which looks like:
 * "ASA 92.28 | <session name> | <map> | <mode> | Process <pid> | Players: <n>/<max> | Mem: <x> GB"
 * That title only gets set a few seconds into the process starting up - callers should
 * expect null before then, same as any other field that fills in once the server is running.
 */
export function parseGameVersionFromTitle(title: string): string | null {
  const match = /^ASA\s+([\d.]+)/.exec(title.trim())
  return match ? match[1] : null
}

/**
 * Reads a process's console window title via PowerShell. ARK's dedicated server
 * allocates its own console window on Windows rather than writing through stdout (see
 * serverProcess.ts's spawn call), so this is the only way to read the version it
 * displays there. Windows-only - resolves to null on any other platform, or if the
 * process/window is gone.
 */
export function getWindowTitle(pid: number): Promise<string | null> {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return Promise.resolve(null)

  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`
    ])
    let output = ''
    ps.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    ps.on('error', () => resolve(null))
    ps.on('close', () => resolve(output.trim() || null))
  })
}

export async function getGameVersion(pid: number): Promise<string | null> {
  const title = await getWindowTitle(pid)
  return title ? parseGameVersionFromTitle(title) : null
}
