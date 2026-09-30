import { ipcMain, type WebContents } from 'electron'
import { IPC, type BackupLogEntry } from '@shared/types'
import { getMinecraftProfile } from '../store'
import {
  createMinecraftBackup,
  listMinecraftBackups,
  deleteMinecraftBackup,
  restoreMinecraftBackup,
  openMinecraftBackupFolder,
  minecraftBackupEvents,
  getMinecraftBackupLog
} from '../lib/minecraftBackup'
import { getMinecraftBackupScheduleStatus } from '../lib/minecraftBackupSchedule'

function requireProfile(profileId: string) {
  const profile = getMinecraftProfile(profileId)
  if (!profile) throw new Error(`Unknown Minecraft profile: ${profileId}`)
  return profile
}

export function registerMinecraftBackupHandlers(webContents: WebContents): void {
  minecraftBackupEvents.on('created', (profileId: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.minecraftBackupCreated, profileId)
  })

  minecraftBackupEvents.on('log', (profileId: string, entry: BackupLogEntry) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.minecraftBackupLogChanged, profileId, entry)
  })

  ipcMain.handle(IPC.minecraftBackupCreate, (_event, profileId: string) => createMinecraftBackup(requireProfile(profileId)))

  ipcMain.handle(IPC.minecraftBackupList, (_event, profileId: string) => listMinecraftBackups(requireProfile(profileId)))

  ipcMain.handle(IPC.minecraftBackupDelete, (_event, filePath: string) => deleteMinecraftBackup(filePath))

  ipcMain.handle(IPC.minecraftBackupRestore, (_event, profileId: string, filePath: string) =>
    restoreMinecraftBackup(requireProfile(profileId), filePath)
  )

  ipcMain.handle(IPC.minecraftBackupOpenFolder, (_event, profileId: string) => openMinecraftBackupFolder(requireProfile(profileId)))

  ipcMain.handle(IPC.minecraftBackupScheduleStatus, (_event, profileId: string) =>
    getMinecraftBackupScheduleStatus(requireProfile(profileId))
  )

  ipcMain.handle(IPC.minecraftBackupLogGet, (_event, profileId: string) => getMinecraftBackupLog(profileId))
}
