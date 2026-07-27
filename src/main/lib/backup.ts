import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import archiver from 'archiver'
import AdmZip from 'adm-zip'
import type { ServerProfile, BackupEntry } from '@shared/types'

function savedArksDir(profile: ServerProfile): string {
  return path.join(profile.installDir, 'ShooterGame', 'Saved', 'SavedArks', profile.map)
}

function backupPrefix(profile: ServerProfile): string {
  return profile.name.replace(/\s+/g, '_')
}

export function createBackup(profile: ServerProfile): Promise<BackupEntry> {
  return new Promise((resolve, reject) => {
    if (!profile.backupDir.trim()) {
      reject(new Error('Set a backup directory in the Backups tab first.'))
      return
    }

    const sourceDir = savedArksDir(profile)
    if (!fs.existsSync(sourceDir)) {
      reject(new Error(`SavedArks folder not found: ${sourceDir}`))
      return
    }

    fs.mkdirSync(profile.backupDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `${backupPrefix(profile)}-${timestamp}.zip`
    const filePath = path.join(profile.backupDir, fileName)

    const output = fs.createWriteStream(filePath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => {
      const entry: BackupEntry = {
        fileName,
        filePath,
        createdAt: Date.now(),
        sizeBytes: archive.pointer()
      }
      pruneOldBackups(profile)
      resolve(entry)
    })
    archive.on('error', reject)

    archive.pipe(output)
    archive.directory(sourceDir, false)
    void archive.finalize()
  })
}

export function listBackups(profile: ServerProfile): BackupEntry[] {
  if (!fs.existsSync(profile.backupDir)) return []
  const prefix = `${backupPrefix(profile)}-`
  return fs
    .readdirSync(profile.backupDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.zip'))
    .map((fileName) => {
      const filePath = path.join(profile.backupDir, fileName)
      const stat = fs.statSync(filePath)
      return { fileName, filePath, createdAt: stat.mtimeMs, sizeBytes: stat.size }
    })
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
