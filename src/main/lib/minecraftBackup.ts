import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { shell } from 'electron'
import archiver from 'archiver'
import AdmZip from 'adm-zip'
import type { BackupEntry, BackupLogEntry } from '@shared/types'
import type { MinecraftProfile } from '@shared/minecraft'
import { isRunning, sendStdinCommand } from './minecraftProcess'
import { sendMinecraftRconCommand } from './minecraftRcon'
import { readServerProperties } from './minecraftProperties'
import { delay } from './delay'
import { logManagerEvent, newTaskId } from './managerLog'

/** Emits 'created' with a profileId whenever a backup finishes - manual or scheduled - so
 *  the Backup tab can reload its list without polling. Also emits 'log' with (profileId,
 *  BackupLogEntry) at each step, same shape as ARK's own backup.ts. */
export const minecraftBackupEvents = new EventEmitter()

const MAX_LOG_ENTRIES = 200
const backupLogs = new Map<string, BackupLogEntry[]>()

export function logMinecraftBackup(profileId: string, message: string, level: BackupLogEntry['level'] = 'info'): void {
  const entry: BackupLogEntry = { timestamp: Date.now(), level, message }
  const entries = backupLogs.get(profileId) ?? []
  entries.push(entry)
  if (entries.length > MAX_LOG_ENTRIES) entries.shift()
  backupLogs.set(profileId, entries)
  minecraftBackupEvents.emit('log', profileId, entry)
}

export function getMinecraftBackupLog(profileId: string): BackupLogEntry[] {
  return backupLogs.get(profileId) ?? []
}

/** The world's dimension folders actually present on disk, in `installDir`'s root - vanilla/
 *  Paper/Spigot/Forge/Fabric all use the same convention: `<level-name>` for the overworld,
 *  plus `<level-name>_nether`/`<level-name>_the_end` alongside it once a player has actually
 *  visited those dimensions (they don't exist before then, and aren't created just to back
 *  one up). `level-name` defaults to "world" the same way the vanilla server itself defaults
 *  it when server.properties doesn't set it. */
export function worldDirs(profile: MinecraftProfile): string[] {
  const levelName = readServerProperties(profile.installDir)['level-name']?.trim() || 'world'
  return [levelName, `${levelName}_nether`, `${levelName}_the_end`].filter((name) =>
    fs.existsSync(path.join(profile.installDir, name))
  )
}

/** How long to wait after sending `save-all flush` before actually reading the world files -
 *  shorter than ARK's own SAVE_SETTLE_MS (ARK's SaveGame confirmation over RCON doesn't mean
 *  the files are done writing; Minecraft's `save-all flush` blocks the server thread until
 *  the write itself is complete, so this is just a safety margin for the OS to finish
 *  flushing to disk, not the write itself). */
const SAVE_SETTLE_MS = 5_000

async function sendSaveCommand(profile: MinecraftProfile, command: string): Promise<void> {
  if (sendStdinCommand(profile.id, command)) return
  const result = await sendMinecraftRconCommand(profile.installDir, command).catch(
    (err: Error) => ({ ok: false, error: err.message }) as const
  )
  if (!result.ok) {
    logMinecraftBackup(
      profile.id,
      `Could not send "${command}" (no stdin, and RCON didn't work either: ${result.error}) - backing up as-is.`,
      'error'
    )
  }
}

/**
 * Backs up the world's dimension folders (see worldDirs above). While the server is running,
 * this disables autosave (`save-off`), forces a synchronous save (`save-all flush`), waits
 * saveSettleMs for the OS to finish flushing to disk, zips, then re-enables autosave
 * (`save-on`) - best-effort: unlike ARK's own createBackup, a failed/unconfirmed save command
 * doesn't cancel the backup outright (Minecraft's own autosave already runs every few minutes
 * regardless, so the worst case here is a backup that's a few seconds staler than requested,
 * not a corrupt one). While the server is stopped, nothing is writing to those files, so it's
 * already safe to zip as-is.
 */
export async function createMinecraftBackup(profile: MinecraftProfile, saveSettleMs = SAVE_SETTLE_MS): Promise<BackupEntry> {
  const taskId = newTaskId('mc-backup')
  const taskLabel = `Backup — ${profile.name}`
  logManagerEvent(taskId, taskLabel, 'Started')

  if (!profile.backupDir.trim()) {
    const message = 'Set a backup directory in the Backup tab first.'
    logMinecraftBackup(profile.id, message, 'error')
    logManagerEvent(taskId, taskLabel, `Failed: ${message}`, 'error')
    throw new Error(message)
  }

  const running = isRunning(profile.id)
  if (running) {
    logMinecraftBackup(profile.id, 'Disabling autosave and flushing the world to disk (save-all flush)...')
    await sendSaveCommand(profile, 'save-off')
    await sendSaveCommand(profile, 'save-all flush')
    logMinecraftBackup(profile.id, `Waiting ${Math.round(saveSettleMs / 1000)}s for the save to settle...`)
    await delay(saveSettleMs)
  } else {
    logMinecraftBackup(profile.id, 'Server is not running - backing up the world files as they are on disk.')
  }

  const dirs = worldDirs(profile)
  if (dirs.length === 0) {
    if (running) await sendSaveCommand(profile, 'save-on')
    const message = `No world folder found under ${profile.installDir} - backup cancelled.`
    logMinecraftBackup(profile.id, message, 'error')
    logManagerEvent(taskId, taskLabel, `Failed: ${message}`, 'error')
    throw new Error(message)
  }

  fs.mkdirSync(profile.backupDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `world-${timestamp}.zip`
  const filePath = path.join(profile.backupDir, fileName)

  logMinecraftBackup(profile.id, `Zipping ${dirs.join(', ')} into ${fileName}...`)
  const output = fs.createWriteStream(filePath)
  const archive = archiver('zip', { zlib: { level: 6 } })

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      const entry: BackupEntry = {
        fileName,
        filePath,
        createdAt: Date.now(),
        sizeBytes: archive.pointer()
      }
      logMinecraftBackup(profile.id, `Backup created: ${fileName} (${(entry.sizeBytes / (1024 * 1024)).toFixed(1)} MB)`)
      logManagerEvent(taskId, taskLabel, `Completed: ${fileName} (${(entry.sizeBytes / (1024 * 1024)).toFixed(1)} MB)`)
      pruneOldMinecraftBackups(profile)
      minecraftBackupEvents.emit('created', profile.id)
      if (running) void sendSaveCommand(profile, 'save-on')
      resolve(entry)
    })
    archive.on('error', (err) => {
      logMinecraftBackup(profile.id, `Backup failed while zipping: ${err.message}`, 'error')
      logManagerEvent(taskId, taskLabel, `Failed while zipping: ${err.message}`, 'error')
      if (running) void sendSaveCommand(profile, 'save-on')
      reject(err)
    })

    archive.pipe(output)
    for (const dir of dirs) {
      archive.directory(path.join(profile.installDir, dir), dir)
    }
    void archive.finalize()
  })
}

function statEntry(backupDir: string, fileName: string): BackupEntry {
  const filePath = path.join(backupDir, fileName)
  const stat = fs.statSync(filePath)
  return { fileName, filePath, createdAt: stat.mtimeMs, sizeBytes: stat.size }
}

export function listMinecraftBackups(profile: MinecraftProfile): BackupEntry[] {
  if (!fs.existsSync(profile.backupDir)) return []
  return fs
    .readdirSync(profile.backupDir)
    .filter((f) => f.endsWith('.zip'))
    .map((fileName) => statEntry(profile.backupDir, fileName))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Pure helper: given backups (any order) and how many to keep, returns the ones to delete. */
export function selectMinecraftBackupsToPrune(entries: BackupEntry[], maxBackups: number): BackupEntry[] {
  if (maxBackups <= 0) return []
  return [...entries].sort((a, b) => b.createdAt - a.createdAt).slice(maxBackups)
}

export function pruneOldMinecraftBackups(profile: MinecraftProfile): void {
  const toDelete = selectMinecraftBackupsToPrune(listMinecraftBackups(profile), profile.maxBackups)
  for (const backup of toDelete) {
    fs.rmSync(backup.filePath, { force: true })
  }
}

export function deleteMinecraftBackup(filePath: string): void {
  fs.rmSync(filePath, { force: true })
}

export function restoreMinecraftBackup(profile: MinecraftProfile, backupFilePath: string): void {
  const taskId = newTaskId('mc-restore')
  const taskLabel = `Restore — ${profile.name}`
  if (isRunning(profile.id)) {
    // Same reasoning as ARK's own restoreBackup - extracting straight into the world folder
    // while the server is up overwrites files it may have open/locked, or mid-write to
    // during its own autosave, producing a corruption that only surfaces as a crash on the
    // next restart.
    const message = 'Stop the server before restoring a backup.'
    logManagerEvent(taskId, taskLabel, `Failed: ${message}`, 'error')
    throw new Error(message)
  }
  try {
    const zip = new AdmZip(backupFilePath)
    zip.extractAllTo(profile.installDir, true)
    logManagerEvent(taskId, taskLabel, `Completed: ${path.basename(backupFilePath)}`)
  } catch (err) {
    logManagerEvent(taskId, taskLabel, `Failed: ${(err as Error).message}`, 'error')
    throw err
  }
}

export async function openMinecraftBackupFolder(profile: MinecraftProfile): Promise<void> {
  if (!profile.backupDir.trim()) {
    throw new Error('Set a backup directory in the Backup tab first.')
  }
  fs.mkdirSync(profile.backupDir, { recursive: true })
  const error = await shell.openPath(profile.backupDir)
  if (error) throw new Error(error)
}
