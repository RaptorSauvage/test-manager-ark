import fs from 'node:fs'
import path from 'node:path'
import type { ServerProfile } from '@shared/types'
import type { PlayerConnectionEvent } from './playerConnectionWatcher'

const MTIME_POLL_INTERVAL_MS = 500
const MTIME_POLL_TIMEOUT_MS = 15000
/** Kept per-player, not per-profile - each player gets their own folder. */
const MAX_BACKUPS_PER_PLAYER = 20

/** Strips characters that aren't safe in a Windows file/folder name. */
export function sanitizeForFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'unknown'
}

function getPlayerProfileFilePath(profile: ServerProfile, uniqueNetId: string): string {
  return path.join(profile.installDir, 'ShooterGame', 'Saved', 'SavedArks', profile.map, `${uniqueNetId}.arkprofile`)
}

function getPlayerBackupDir(profile: ServerProfile, event: PlayerConnectionEvent): string {
  return path.join(profile.backupDir, 'PlayerBackups', `${sanitizeForFilename(event.playerName)}_${event.uniqueNetId}`)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Waits (bounded) for the profile file's mtime to move past `sinceMs` - ARK writes the
 * updated file shortly after a disconnect rather than instantly. Gives up and proceeds
 * anyway after the timeout: a slightly-stale snapshot beats silently backing up nothing.
 */
async function waitForFileUpdate(filePath: string, sinceMs: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (fs.statSync(filePath).mtimeMs > sinceMs) return
    } catch {
      // Not written yet - keep waiting.
    }
    await wait(MTIME_POLL_INTERVAL_MS)
  }
}

function pruneOldPlayerBackups(dir: string): void {
  const entries = fs
    .readdirSync(dir)
    .map((fileName) => path.join(dir, fileName))
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  for (const stale of entries.slice(MAX_BACKUPS_PER_PLAYER)) {
    fs.rmSync(stale.filePath, { force: true })
  }
}

/**
 * Backs up a player's .arkprofile at connect/disconnect into its own dedicated,
 * per-player folder under the profile's backup directory. On 'left', waits briefly for
 * ARK to actually finish writing the post-disconnect save before copying.
 */
export async function backupPlayerProfile(profile: ServerProfile, event: PlayerConnectionEvent): Promise<void> {
  if (!profile.backupDir.trim()) {
    throw new Error('Set a backup directory in the Backups tab first.')
  }

  const sourcePath = getPlayerProfileFilePath(profile, event.uniqueNetId)

  if (event.type === 'left') {
    const sinceMs = fs.existsSync(sourcePath) ? fs.statSync(sourcePath).mtimeMs : 0
    await waitForFileUpdate(sourcePath, sinceMs, MTIME_POLL_TIMEOUT_MS)
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Player profile file not found: ${sourcePath}`)
  }

  const destDir = getPlayerBackupDir(profile, event)
  fs.mkdirSync(destDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destPath = path.join(destDir, `${timestamp}_${event.type}.arkprofile`)
  fs.copyFileSync(sourcePath, destPath)
  pruneOldPlayerBackups(destDir)
}
