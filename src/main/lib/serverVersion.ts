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

function runPowerShell(command: string): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)

  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true
    })
    let output = ''
    ps.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    ps.on('error', () => resolve(null))
    ps.on('close', () => resolve(output.trim() || null))
  })
}

/**
 * Reads a process's console window title via PowerShell. ARK's dedicated server
 * allocates its own console window on Windows rather than writing through stdout (see
 * serverProcess.ts's spawn call), so this is the only way to read the version it
 * displays there. Windows-only - resolves to null on any other platform, or if the
 * process/window is gone.
 */
export function getWindowTitle(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(null)
  return runPowerShell(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`)
}

/**
 * Falls back to scanning every process for one whose console title looks like ARK's own
 * ("ASA <version> | ..."), regardless of which pid actually owns that window. Needed
 * because a server adopted after a Manager restart can have a tracked pid that Windows
 * doesn't consider the owner of its own console window (its telemetry - CPU/memory via
 * pidusage - still works fine since that only needs the pid to be alive, not to own a
 * window). The version number is the same shared game build across every server on this
 * machine either way, so grabbing any match is exactly as correct as matching the exact pid.
 */
export function findAnyArkServerWindowTitle(): Promise<string | null> {
  return runPowerShell(
    "(Get-Process | Where-Object { $_.MainWindowTitle -like 'ASA *' } | Select-Object -First 1 -ExpandProperty MainWindowTitle)"
  )
}

export async function getGameVersion(
  pid: number,
  fetchWindowTitle: (pid: number) => Promise<string | null> = getWindowTitle,
  fetchFallbackTitle: () => Promise<string | null> = findAnyArkServerWindowTitle
): Promise<string | null> {
  const direct = await fetchWindowTitle(pid)
  const version = direct ? parseGameVersionFromTitle(direct) : null
  if (version) return version

  const fallbackTitle = await fetchFallbackTitle()
  return fallbackTitle ? parseGameVersionFromTitle(fallbackTitle) : null
}

/**
 * Caches the detected game version per profile, in memory, for the lifetime of the
 * Manager process - so it's only ever detected once instead of on every Analytics tab
 * mount, and stays valid across the server simply being stopped/restarted (the installed
 * build doesn't change just because the process did). Invalidated only when an actual
 * update is run (see serverActions.ts's doUpdateServer), since that's the one thing that
 * can actually change which version is installed.
 */
const gameVersionCache = new Map<string, string>()

export function getCachedGameVersion(profileId: string): string | null {
  return gameVersionCache.get(profileId) ?? null
}

export function setCachedGameVersion(profileId: string, version: string): void {
  gameVersionCache.set(profileId, version)
}

export function clearCachedGameVersion(profileId: string): void {
  gameVersionCache.delete(profileId)
}
