import { ipcMain } from 'electron'
import { IPC, type ServerProfile } from '@shared/types'
import { listProfiles, saveProfile, deleteProfile } from '../store'
import { applyBackupSchedule, clearBackupSchedule } from '../lib/schedule'

export function registerProfileHandlers(): void {
  ipcMain.handle(IPC.profilesList, () => listProfiles())

  ipcMain.handle(IPC.profilesSave, (_event, profile: ServerProfile) => {
    const profiles = saveProfile(profile)
    applyBackupSchedule(profile)
    return profiles
  })

  ipcMain.handle(IPC.profilesDelete, (_event, id: string) => {
    clearBackupSchedule(id)
    return deleteProfile(id)
  })
}
