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
 * Manager process - so it's only ever read from the log once instead of on every
 * Analytics tab mount, and stays valid across the server simply being stopped/restarted
 * (the installed build doesn't change just because the process did). Invalidated only
 * when an actual update is run (see serverActions.ts's doUpdateServer), since that's the
 * one thing that can actually change which version is installed.
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
