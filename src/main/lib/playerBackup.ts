import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import AdmZip from 'adm-zip'
import type { BackupEntry, PlayerBackupFolder, ServerProfile } from '@shared/types'
import type { PlayerConnectionEvent } from './playerConnectionWatcher'

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

function getPlayerBackupsRootDir(profile: ServerProfile): string {
  return path.join(profile.backupDir, 'PlayerBackups')
}

function getPlayerBackupDir(profile: ServerProfile, event: PlayerConnectionEvent): string {
  return path.join(getPlayerBackupsRootDir(profile), `${sanitizeForFilename(event.playerName)}_${event.uniqueNetId}`)
}

/** Folder names are "<sanitized player name>_<uniqueNetId>" - split back out for display. */
const FOLDER_NAME_REGEX = /^(.*)_([0-9a-f]{8,})$/i

export function parsePlayerBackupFolderName(folderName: string): { playerName: string; uniqueNetId: string } | null {
  const match = folderName.match(FOLDER_NAME_REGEX)
  if (!match) return null
  return { playerName: match[1], uniqueNetId: match[2].toLowerCase() }
}

/** Every player who has at least one backup for this profile, for a "pick a player" selector. */
export function listPlayerBackupFolders(profile: ServerProfile): PlayerBackupFolder[] {
  if (!profile.backupDir.trim()) return []
  const root = getPlayerBackupsRootDir(profile)
  if (!fs.existsSync(root)) return []

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const parsed = parsePlayerBackupFolderName(entry.name)
      return { key: entry.name, playerName: parsed?.playerName ?? entry.name, uniqueNetId: parsed?.uniqueNetId ?? '' }
    })
    .sort((a, b) => a.playerName.localeCompare(b.playerName))
}

/** The backup zips for one specific player folder, newest first - same shape as world backups. */
export function listPlayerBackups(profile: ServerProfile, folderKey: string): BackupEntry[] {
  const dir = path.join(getPlayerBackupsRootDir(profile), folderKey)
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((fileName) => fileName.endsWith('.zip'))
    .map((fileName) => {
      const filePath = path.join(dir, fileName)
      const stat = fs.statSync(filePath)
      return { fileName, filePath, createdAt: stat.mtimeMs, sizeBytes: stat.size }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function openPlayerBackupFolder(profile: ServerProfile, folderKey: string): Promise<void> {
  const dir = path.join(getPlayerBackupsRootDir(profile), folderKey)
  fs.mkdirSync(dir, { recursive: true })
  const error = await shell.openPath(dir)
  if (error) throw new Error(error)
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

function pruneOldPlayerBackups(dir: string, maxPerPlayer: number): void {
  if (maxPerPlayer <= 0) return
  const entries = fs
    .readdirSync(dir)
    .map((fileName) => path.join(dir, fileName))
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  for (const stale of entries.slice(maxPerPlayer)) {
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

  pruneOldPlayerBackups(destDir, profile.playerProfileBackupMaxPerPlayer)
}
