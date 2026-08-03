import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { shell } from 'electron'
import archiver from 'archiver'
import AdmZip from 'adm-zip'
import type { ServerProfile, BackupEntry } from '@shared/types'
import { sendRconCommand } from './rcon'
import { isRunning } from './serverProcess'

/** Emits 'created' with a profileId whenever a backup finishes - manual or scheduled -
 *  so the renderer can reload its backup list without polling. */
export const backupEvents = new EventEmitter()

function savedArksDir(profile: ServerProfile): string {
  return path.join(profile.installDir, 'ShooterGame', 'Saved', 'SavedArks', profile.map)
}

function backupPrefix(profile: ServerProfile): string {
  return profile.name.replace(/\s+/g, '_')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Recognizes a previous manager tool's backup naming convention - `<Map>_
 * <YYYYMMDDHHMMSS>.zip` (e.g. `Genesis_WP_20260720103215.zip`) - so those backups can
 * still be browsed/restored here during a transition, without this app ever having
 * written them itself.
 */
export function isLegacyBackupFileName(fileName: string, map: string): boolean {
  if (!map) return false
  return new RegExp(`^${escapeRegExp(map)}_\\d{14}\\.zip$`).test(fileName)
}

/** .arkrbf files are ARK's own transient rollback data next to the real saves - not
 *  useful in a backup and just extra weight/noise, so leave them out of the zip. */
export function isIgnoredBackupFile(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith('.arkrbf')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** How long to wait after RCON confirms SaveGame before actually reading the save files -
 *  the RCON response only means ARK accepted the command, not that every file under
 *  SavedArks has finished being written. Zipping too soon risks reading a file mid-write,
 *  which can crash the server (Windows locks a file that's still open for writing) as well
 *  as produce a corrupt backup. 30s is the same margin community backup scripts for ARK
 *  use for this exact reason. */
const SAVE_SETTLE_MS = 30_000

/**
 * Backs up the active map's SavedArks folder: send SaveGame over RCON, wait for it to be
 * confirmed, wait another saveSettleMs for ARK to finish writing everything to disk, then
 * zip that folder's files (added one by one, skipping .arkrbf) into the configured backup
 * directory. A confirmed SaveGame is required - if the server isn't running or RCON
 * doesn't confirm the save, the backup is cancelled outright rather than zipping a
 * possibly-stale or mid-write state.
 */
export async function createBackup(profile: ServerProfile, saveSettleMs = SAVE_SETTLE_MS): Promise<BackupEntry> {
  if (!profile.backupDir.trim()) {
    throw new Error('Set a backup directory in the Backups tab first.')
  }
  if (!isRunning(profile.id)) {
    throw new Error('Start the server before creating a backup - a confirmed SaveGame is required first.')
  }

  const saveResult = await sendRconCommand(profile, 'SaveWorld')
  if (!saveResult.ok) {
    throw new Error(`SaveGame did not confirm, backup cancelled: ${saveResult.error ?? 'no response from RCON'}`)
  }
  await delay(saveSettleMs)

  const sourceDir = savedArksDir(profile)
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`SavedArks folder not found: ${sourceDir}`)
  }
  const files = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !isIgnoredBackupFile(entry.name))
    .map((entry) => entry.name)

  fs.mkdirSync(profile.backupDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `${backupPrefix(profile)}-${timestamp}.zip`
  const filePath = path.join(profile.backupDir, fileName)

  const output = fs.createWriteStream(filePath)
  const archive = archiver('zip', { zlib: { level: 9 } })

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      const entry: BackupEntry = {
        fileName,
        filePath,
        createdAt: Date.now(),
        sizeBytes: archive.pointer()
      }
      pruneOldBackups(profile)
      backupEvents.emit('created', profile.id)
      resolve(entry)
    })
    archive.on('error', reject)

    archive.pipe(output)
    for (const file of files) {
      archive.file(path.join(sourceDir, file), { name: file })
    }
    void archive.finalize()
  })
}

function statEntry(backupDir: string, fileName: string, legacy: boolean): BackupEntry {
  const filePath = path.join(backupDir, fileName)
  const stat = fs.statSync(filePath)
  return { fileName, filePath, createdAt: stat.mtimeMs, sizeBytes: stat.size, ...(legacy ? { legacy: true } : {}) }
}

/** This app's own backups only - used for retention/pruning, so a legacy backup (see
 *  isLegacyBackupFileName) is never counted against maxBackups or auto-deleted. */
function listOwnBackups(profile: ServerProfile): BackupEntry[] {
  if (!fs.existsSync(profile.backupDir)) return []
  const prefix = `${backupPrefix(profile)}-`
  return fs
    .readdirSync(profile.backupDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.zip'))
    .map((fileName) => statEntry(profile.backupDir, fileName, false))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Every backup for this profile - this app's own plus any recognized legacy ones (from
 *  a previous manager tool), so both are browsable/restorable during a transition. */
export function listBackups(profile: ServerProfile): BackupEntry[] {
  if (!fs.existsSync(profile.backupDir)) return []
  const prefix = `${backupPrefix(profile)}-`
  return fs
    .readdirSync(profile.backupDir)
    .filter((f) => f.endsWith('.zip') && (f.startsWith(prefix) || isLegacyBackupFileName(f, profile.map)))
    .map((fileName) => statEntry(profile.backupDir, fileName, !fileName.startsWith(prefix)))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Pure helper: given backups (any order) and how many to keep, returns the ones to delete. */
export function selectBackupsToPrune(entries: BackupEntry[], maxBackups: number): BackupEntry[] {
  if (maxBackups <= 0) return []
  return [...entries].sort((a, b) => b.createdAt - a.createdAt).slice(maxBackups)
}

export function pruneOldBackups(profile: ServerProfile): void {
  const toDelete = selectBackupsToPrune(listOwnBackups(profile), profile.maxBackups)
  for (const backup of toDelete) {
    fs.rmSync(backup.filePath, { force: true })
  }
}

export function deleteBackup(filePath: string): void {
  fs.rmSync(filePath, { force: true })
}

export function restoreBackup(profile: ServerProfile, backupFilePath: string): void {
  if (isRunning(profile.id)) {
    // Extracting straight into SavedArks while the server is up overwrites save files it
    // may have open/locked, or that it's mid-write to during its own autosave - either
    // way the result is a corrupted save that only surfaces as a crash on the next
    // restart, not at restore time. Requiring a stop first (same as Profile Copy/Move)
    // makes this a plain file copy against files nothing else is touching.
    throw new Error('Stop the server before restoring a backup.')
  }
  const targetDir = savedArksDir(profile)
  fs.mkdirSync(targetDir, { recursive: true })
  const zip = new AdmZip(backupFilePath)
  zip.extractAllTo(targetDir, true)
}

export async function openBackupFolder(profile: ServerProfile): Promise<void> {
  if (!profile.backupDir.trim()) {
    throw new Error('Set a backup directory in the Backups tab first.')
  }
  fs.mkdirSync(profile.backupDir, { recursive: true })
  const error = await shell.openPath(profile.backupDir)
  if (error) throw new Error(error)
}
