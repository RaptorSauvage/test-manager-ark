import { ipcMain, type WebContents } from 'electron'
import { IPC } from '@shared/types'
import { getProfile } from '../store'
import { createBackup, listBackups, deleteBackup, restoreBackup, openBackupFolder, backupEvents } from '../lib/backup'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerBackupHandlers(webContents: WebContents): void {
  backupEvents.on('created', (profileId: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.backupCreated, profileId)
  })

  ipcMain.handle(IPC.backupCreate, (_event, profileId: string) => createBackup(requireProfile(profileId)))

  ipcMain.handle(IPC.backupList, (_event, profileId: string) => listBackups(requireProfile(profileId)))

  ipcMain.handle(IPC.backupDelete, (_event, filePath: string) => deleteBackup(filePath))

  ipcMain.handle(IPC.backupRestore, (_event, profileId: string, filePath: string) =>
    restoreBackup(requireProfile(profileId), filePath)
  )

  ipcMain.handle(IPC.backupOpenFolder, (_event, profileId: string) => openBackupFolder(requireProfile(profileId)))
}
