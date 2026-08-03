import { ipcMain, type WebContents } from 'electron'
import { IPC, type BackupLogEntry } from '@shared/types'
import { getProfile } from '../store'
import {
  createBackup,
  listBackups,
  deleteBackup,
  restoreBackup,
  openBackupFolder,
  backupEvents,
  getBackupLog
} from '../lib/backup'
import { getBackupScheduleStatus } from '../lib/schedule'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerBackupHandlers(webContents: WebContents): void {
  backupEvents.on('created', (profileId: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.backupCreated, profileId)
  })

  backupEvents.on('log', (profileId: string, entry: BackupLogEntry) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.backupLogChanged, profileId, entry)
  })

  ipcMain.handle(IPC.backupCreate, (_event, profileId: string) => createBackup(requireProfile(profileId)))

  ipcMain.handle(IPC.backupList, (_event, profileId: string) => listBackups(requireProfile(profileId)))

  ipcMain.handle(IPC.backupDelete, (_event, filePath: string) => deleteBackup(filePath))

  ipcMain.handle(IPC.backupRestore, (_event, profileId: string, filePath: string) =>
    restoreBackup(requireProfile(profileId), filePath)
  )

  ipcMain.handle(IPC.backupOpenFolder, (_event, profileId: string) => openBackupFolder(requireProfile(profileId)))

  ipcMain.handle(IPC.backupScheduleStatus, (_event, profileId: string) =>
    getBackupScheduleStatus(requireProfile(profileId))
  )

  ipcMain.handle(IPC.backupLogGet, (_event, profileId: string) => getBackupLog(profileId))
}
