import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { shell } from 'electron'
import archiver from 'archiver'
import AdmZip from 'adm-zip'
import type { ServerProfile, BackupEntry, BackupLogEntry } from '@shared/types'
import { sendRconCommand } from './rcon'
import { isRunning } from './serverProcess'
import { delay } from './delay'

/** Emits 'created' with a profileId whenever a backup finishes - manual or scheduled -
 *  so the renderer can reload its backup list without polling. Also emits 'log' with
 *  (profileId, BackupLogEntry) at each step of a backup's SaveGame -> settle -> zip
 *  sequence, so the Backups tab can show a live process log for monitoring/debugging -
 *  useful in particular for a scheduled backup nobody's watching happen in real time. */
export const backupEvents = new EventEmitter()

/** How many recent log entries to keep in memory per profile - old enough entries just
 *  roll off, there's no need to persist this across app restarts. */
const MAX_LOG_ENTRIES = 200
const backupLogs = new Map<string, BackupLogEntry[]>()

function logBackup(profileId: string, message: string, level: BackupLogEntry['level'] = 'info'): void {
  const entry: BackupLogEntry = { timestamp: Date.now(), level, message }
  const entries = backupLogs.get(profileId) ?? []
  entries.push(entry)
  if (entries.length > MAX_LOG_ENTRIES) entries.shift()
  backupLogs.set(profileId, entries)
  backupEvents.emit('log', profileId, entry)
}

export function getBackupLog(profileId: string): BackupLogEntry[] {
  return backupLogs.get(profileId) ?? []
}

function savedArksDir(profile: ServerProfile): string {
  return path.join(profile.installDir, 'ShooterGame', 'Saved', 'SavedArks', profile.map)
}

function backupPrefix(profile: ServerProfile): string {
  return profile.map.replace(/\s+/g, '_')
}

/** .arkrbf files are ARK's own transient rollback data next to the real saves - not
 *  useful in a backup and just extra weight/noise, so leave them out of the zip. */
export function isIgnoredBackupFile(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith('.arkrbf')
}

/** How long to wait after RCON confirms SaveGame before actually reading the save files -
 *  the RCON response only means ARK accepted the command, not that every file under
 *  SavedArks has finished being written. Zipping too soon risks reading a file mid-write,
 *  which can crash the server (Windows locks a file that's still open for writing) as well
 *  as produce a corrupt backup. */
const SAVE_SETTLE_MS = 40_000

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
    const message = 'Set a backup directory in the Backups tab first.'
    logBackup(profile.id, message, 'error')
    throw new Error(message)
  }
  if (!isRunning(profile.id)) {
    const message = 'Start the server before creating a backup - a confirmed SaveGame is required first.'
    logBackup(profile.id, message, 'error')
    throw new Error(message)
  }

  logBackup(profile.id, 'Sending SaveGame (RCON SaveWorld)...')
  const saveResult = await sendRconCommand(profile, 'SaveWorld')
  if (!saveResult.ok) {
    const message = `SaveGame did not confirm, backup cancelled: ${saveResult.error ?? 'no response from RCON'}`
    logBackup(profile.id, message, 'error')
    throw new Error(message)
  }
  logBackup(profile.id, `SaveGame confirmed - waiting ${Math.round(saveSettleMs / 1000)}s for the save to settle...`)
  await delay(saveSettleMs)

  const sourceDir = savedArksDir(profile)
  if (!fs.existsSync(sourceDir)) {
    const message = `SavedArks folder not found: ${sourceDir} - backup cancelled.`
    logBackup(profile.id, message, 'error')
    throw new Error(message)
  }
  const files = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !isIgnoredBackupFile(entry.name))
    .map((entry) => entry.name)

  fs.mkdirSync(profile.backupDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `${backupPrefix(profile)}-${timestamp}.zip`
  const filePath = path.join(profile.backupDir, fileName)

  logBackup(profile.id, `Zipping ${files.length} file(s) from SavedArks/${profile.map} into ${fileName}...`)
  const output = fs.createWriteStream(filePath)
  // Level 9 (max) barely shrinks already-dense ARK save data further than a mid level,
  // but costs far more CPU - a real contributor to the whole app appearing to hang while
  // a big backup zips, on top of the threadpool contention fixed in main/index.ts.
  const archive = archiver('zip', { zlib: { level: 6 } })

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      const entry: BackupEntry = {
        fileName,
        filePath,
        createdAt: Date.now(),
        sizeBytes: archive.pointer()
      }
      logBackup(profile.id, `Backup created: ${fileName} (${(entry.sizeBytes / (1024 * 1024)).toFixed(1)} MB)`)
      pruneOldBackups(profile)
      backupEvents.emit('created', profile.id)
      resolve(entry)
    })
    archive.on('error', (err) => {
      logBackup(profile.id, `Backup failed while zipping: ${err.message}`, 'error')
      reject(err)
    })

    archive.pipe(output)
    for (const file of files) {
      archive.file(path.join(sourceDir, file), { name: file })
    }
    void archive.finalize()
  })
}

function statEntry(backupDir: string, fileName: string): BackupEntry {
  const filePath = path.join(backupDir, fileName)
  const stat = fs.statSync(filePath)
  return { fileName, filePath, createdAt: stat.mtimeMs, sizeBytes: stat.size }
}

/** Every .zip in the backup directory, regardless of naming - including ones dropped in
 *  by hand or left over from a previous manager tool. There's just one backup folder per
 *  profile, so anything in it is fair game for the viewer, and for maxBackups pruning. */
export function listBackups(profile: ServerProfile): BackupEntry[] {
  if (!fs.existsSync(profile.backupDir)) return []
  return fs
    .readdirSync(profile.backupDir)
    .filter((f) => f.endsWith('.zip'))
    .map((fileName) => statEntry(profile.backupDir, fileName))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Pure helper: given backups (any order) and how many to keep, returns the ones to delete. */
export function selectBackupsToPrune(entries: BackupEntry[], maxBackups: number): BackupEntry[] {
  if (maxBackups <= 0) return []
  return [...entries].sort((a, b) => b.createdAt - a.createdAt).slice(maxBackups)
}

export function pruneOldBackups(profile: ServerProfile): void {
  const toDelete = selectBackupsToPrune(listBackups(profile), profile.maxBackups)
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
