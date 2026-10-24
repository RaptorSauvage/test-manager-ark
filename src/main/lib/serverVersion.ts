import fs from 'node:fs/promises'
import { getLogFilePath } from './serverProcess'

/**
 * Matches the "ARK Version: 92.28" line ARK writes to its own log (ShooterGame.log) near
 * the very start of boot. Reading this straight from the log is simple and cross-platform
 * - a previous version of this feature instead tried to read the version back from the
 * server's own console window title via PowerShell/Win32 APIs, which turned out to not
 * reliably work at all for a server adopted after a Manager restart.
 */
const ARK_VERSION_REGEX = /ARK Version:\s*([\d.]+)/

export function parseArkVersionFromLog(content: string): string | null {
  const match = ARK_VERSION_REGEX.exec(content)
  return match ? match[1] : null
}

// The version line is always near the very top of the log (see this file's own doc comment),
// so there's never a reason to read the rest of it - for a server that's been running a long
// time, ShooterGame.log can grow to hundreds of MB or more, and this is called via Promise.all
// for every profile at once (Dashboard/App mount, every Analytics tab poll); reading each one
// in full really can add up to a multi-minute stall across a cluster of any size, all to find
// a line that's always within the first few KB.
const VERSION_SCAN_BYTES = 64 * 1024

export async function getGameVersion(installDir: string): Promise<string | null> {
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(getLogFilePath(installDir), 'r')
    const buffer = Buffer.alloc(VERSION_SCAN_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, VERSION_SCAN_BYTES, 0)
    return parseArkVersionFromLog(buffer.toString('utf-8', 0, bytesRead))
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

/**
 * Caches the detected game version per profile, in memory, for the lifetime of the
 * Manager process. Populated by serverVersionWatcher.ts the moment a server transitions
 * to 'running' (a fresh start, or one adopted already-running at Manager launch) - reads
 * on demand (e.g. every Analytics tab mount) just return whatever's here. Nothing else
 * writes to this cache, so a stale value naturally gets replaced the next time that
 * server actually starts (including after an update, since that always involves a
 * stop/start cycle) without needing any separate invalidation logic.
 */
const gameVersionCache = new Map<string, string>()

export function getCachedGameVersion(profileId: string): string | null {
  return gameVersionCache.get(profileId) ?? null
}

export function setCachedGameVersion(profileId: string, version: string): void {
  gameVersionCache.set(profileId, version)
}
