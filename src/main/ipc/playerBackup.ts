import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getProfile } from '../store'
import { listPlayerBackupFolders, listPlayerBackups, openPlayerBackupFolder } from '../lib/playerBackup'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerPlayerBackupHandlers(): void {
  ipcMain.handle(IPC.playerBackupFoldersList, (_event, profileId: string) =>
    listPlayerBackupFolders(requireProfile(profileId))
  )

  ipcMain.handle(IPC.playerBackupList, (_event, profileId: string, folderKey: string) =>
    listPlayerBackups(requireProfile(profileId), folderKey)
  )

  ipcMain.handle(IPC.playerBackupOpenFolder, (_event, profileId: string, folderKey: string) =>
    openPlayerBackupFolder(requireProfile(profileId), folderKey)
  )
}
