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

export async function getGameVersion(installDir: string): Promise<string | null> {
  try {
    const content = await fs.readFile(getLogFilePath(installDir), 'utf-8')
    return parseArkVersionFromLog(content)
  } catch {
    return null
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
