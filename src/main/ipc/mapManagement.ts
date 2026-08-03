import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getProfile } from '../store'
import { listMapFolders, createMapFolder, deleteMapFolder, openMapFolder } from '../lib/mapManagement'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerMapManagementHandlers(): void {
  ipcMain.handle(IPC.mapManagementList, (_event, profileId: string) => listMapFolders(requireProfile(profileId)))

  ipcMain.handle(IPC.mapManagementCreate, (_event, profileId: string, folderName: string, fileName: string) =>
    createMapFolder(requireProfile(profileId), folderName, fileName)
  )

  ipcMain.handle(IPC.mapManagementDelete, (_event, profileId: string, folderName: string) =>
    deleteMapFolder(requireProfile(profileId), folderName)
  )

  ipcMain.handle(IPC.mapManagementOpenFolder, (_event, profileId: string, folderName: string) =>
    openMapFolder(requireProfile(profileId), folderName)
  )
}
