import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { IPC, type ServerProfile } from '@shared/types'
import { listProfiles, saveProfile, deleteProfile, setProfileOrder } from '../store'
import { applyBackupSchedule, clearBackupSchedule } from '../lib/schedule'
import {
  applyScheduledRestart,
  applyScheduledDinoWipe,
  clearScheduledRestart,
  clearScheduledDinoWipe
} from '../lib/scheduledActions'
import { isValidArkInstall, detectProfileFields, uniqueProfileName } from '../lib/detect'
import { serializeProfile, parseImportedProfile } from '../lib/profileExport'
import { syncPlayerBackupWatch } from '../lib/playerBackupWatch'
import { copyProfile, moveProfile } from '../lib/profileCopyMove'

function requireProfile(profileId: string): ServerProfile {
  const profile = listProfiles().find((p) => p.id === profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerProfileHandlers(): void {
  ipcMain.handle(IPC.profilesList, () => listProfiles())

  ipcMain.handle(IPC.profilesSave, (_event, profile: ServerProfile) => {
    const profiles = saveProfile(profile)
    applyBackupSchedule(profile)
    syncPlayerBackupWatch(profile)
    applyScheduledRestart(profile)
    applyScheduledDinoWipe(profile)
    return profiles
  })

  ipcMain.handle(IPC.profilesDelete, (_event, id: string) => {
    clearBackupSchedule(id)
    clearScheduledRestart(id)
    clearScheduledDinoWipe(id)
    return deleteProfile(id)
  })

  ipcMain.handle(IPC.profilesReorder, (_event, orderedIds: string[]) => setProfileOrder(orderedIds))

  ipcMain.handle(IPC.profilesExport, (_event, profileId: string, filePath: string) => {
    fs.writeFileSync(filePath, serializeProfile(requireProfile(profileId)), 'utf-8')
  })

  ipcMain.handle(IPC.profilesImportFromFile, (_event, filePath: string) => {
    const existing = listProfiles()
    const profile = parseImportedProfile(fs.readFileSync(filePath, 'utf-8'), existing.map((p) => p.name))
    const profiles = saveProfile(profile)
    applyBackupSchedule(profile)
    applyScheduledRestart(profile)
    applyScheduledDinoWipe(profile)
    return { profile, profiles }
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
      moddedMapEnabled: false,
      moddedMapId: '',
      gamePort: detected.gamePort ?? 7777,
      rconPort: detected.rconPort ?? 27020,
      serverPlatform: 'PC',
      maxPlayers: 70,
      backupDir: '',
      maxBackups: 10,
      backupSchedule: '',
      backupScheduleEnabled: false,
      playerProfileBackupEnabled: false,
      playerProfileBackupMaxPerPlayer: 20,
      mods: detected.mods,
      clusterEnabled: false,
      clusterId: '',
      clusterDirOverride: '',
      noTransferFromFiltering: false,
      externalIp: '',
      cultureSettings: 'none',
      disableBattlEye: false,
      rconTribeLog: false,
      forceRespawnDinos: false,
      noSound: false,
      extraArgs: '',
      scheduledRestartEnabled: false,
      scheduledRestartTime: '00:00',
      scheduledRestartDays: [],
      scheduledRestartUpdateAfter: false,
      scheduledRestartStartAfter: false,
      scheduledDinoWipeEnabled: false,
      scheduledDinoWipeTime: '00:00',
      scheduledDinoWipeDays: [],
      hidden: false,
      group: ''
    }

    const profiles = saveProfile(profile)
    applyBackupSchedule(profile)
    return { profile, profiles }
  })

  ipcMain.handle(IPC.profilesCopy, async (_event, profileId: string, destInstallDir: string, newName: string) => {
    const copied = await copyProfile(requireProfile(profileId), destInstallDir, newName)
    const profiles = saveProfile(copied)
    applyBackupSchedule(copied)
    syncPlayerBackupWatch(copied)
    applyScheduledRestart(copied)
    applyScheduledDinoWipe(copied)
    return { profile: copied, profiles }
  })

  ipcMain.handle(IPC.profilesMove, async (_event, profileId: string, destInstallDir: string, newName: string) => {
    const moved = await moveProfile(requireProfile(profileId), destInstallDir, newName)
    const profiles = saveProfile(moved)
    applyBackupSchedule(moved)
    syncPlayerBackupWatch(moved)
    applyScheduledRestart(moved)
    applyScheduledDinoWipe(moved)
    return { profile: moved, profiles }
  })
}
