import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { ServerProfile } from '@shared/types'
import type { PlayerConnectionEvent } from './playerConnectionWatcher'

/** Kept per-player, not per-profile - each player gets their own folder. */
const MAX_BACKUPS_PER_PLAYER = 20
/** How long to give ARK's own .profilebak write a moment to land before giving up. */
const PROFILEBAK_WAIT_INTERVAL_MS = 200
const PROFILEBAK_WAIT_ATTEMPTS = 10

/** Strips characters that aren't safe in a Windows file/folder name. */
export function sanitizeForFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'unknown'
}

/**
 * ARK itself writes <UniqueNetId>.profilebak - a copy of the player's .arkprofile under a
 * different extension - right around both connect and disconnect. Reading that instead of
 * the live .arkprofile means there's no need to guess/wait for the main file to be rewritten.
 */
function getPlayerProfileBakPath(profile: ServerProfile, uniqueNetId: string): string {
  return path.join(
    profile.installDir,
    'ShooterGame',
    'Saved',
    'SavedArks',
    profile.map,
    `${uniqueNetId}.profilebak`
  )
}

function getPlayerBackupDir(profile: ServerProfile, event: PlayerConnectionEvent): string {
  return path.join(profile.backupDir, 'PlayerBackups', `${sanitizeForFilename(event.playerName)}_${event.uniqueNetId}`)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForFileToExist(filePath: string): Promise<boolean> {
  for (let attempt = 0; attempt < PROFILEBAK_WAIT_ATTEMPTS; attempt++) {
    if (fs.existsSync(filePath)) return true
    await wait(PROFILEBAK_WAIT_INTERVAL_MS)
  }
  return fs.existsSync(filePath)
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
 * Backs up a player's profile at connect/disconnect into a dedicated per-player folder
 * under the profile's backup directory, as a small zip containing the .profilebak
 * content restored to its normal .arkprofile name/extension.
 */
export async function backupPlayerProfile(profile: ServerProfile, event: PlayerConnectionEvent): Promise<void> {
  if (!profile.backupDir.trim()) {
    throw new Error('Set a backup directory in the Backups tab first.')
  }

  const sourcePath = getPlayerProfileBakPath(profile, event.uniqueNetId)
  if (!(await waitForFileToExist(sourcePath))) {
    throw new Error(`Player profile backup file not found: ${sourcePath}`)
  }

  const destDir = getPlayerBackupDir(profile, event)
  fs.mkdirSync(destDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destZipPath = path.join(destDir, `${timestamp}_${event.type}.zip`)

  const zip = new AdmZip()
  zip.addLocalFile(sourcePath, '', `${event.uniqueNetId}.arkprofile`)
  zip.writeZip(destZipPath)

  pruneOldPlayerBackups(destDir)
}
