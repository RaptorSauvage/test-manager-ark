import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { IPC, type ServerProfile } from '@shared/types'
import { listProfiles, saveProfile, deleteProfile } from '../store'
import { applyBackupSchedule, clearBackupSchedule } from '../lib/schedule'
import { isValidArkInstall, detectProfileFields, uniqueProfileName } from '../lib/detect'

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

  ipcMain.handle(IPC.profilesImport, (_event, installDir: string) => {
    if (!isValidArkInstall(installDir)) {
      throw new Error('No ARK: Survival Ascended server executable found in this folder.')
    }

    const detected = detectProfileFields(installDir)
    const existing = listProfiles()

    const profile: ServerProfile = {
      id: randomUUID(),
      name: uniqueProfileName(detected.suggestedName, existing.map((p) => p.name)),
      installDir,
      map: detected.map,
      gamePort: detected.gamePort ?? 7777,
      queryPort: detected.queryPort ?? 27015,
      rconPort: detected.rconPort ?? 27020,
      rconPassword: detected.rconPassword,
      savedArksSubPath: 'ShooterGame/Saved/SavedArks',
      backupDir: '',
      maxBackups: 10,
      backupSchedule: '',
      backupScheduleEnabled: false,
      mods: detected.mods,
      clusterEnabled: false,
      clusterId: '',
      clusterDirOverride: '',
      noTransferFromFiltering: false,
      extraArgs: ''
    }

    const profiles = saveProfile(profile)
    applyBackupSchedule(profile)
    return { profile, profiles }
  })
}
