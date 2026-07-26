import { ipcMain } from 'electron'
import { IPC, type ServerConfigSummary, type RawIniFiles } from '@shared/types'
import { getProfile, saveProfile } from '../store'
import { readConfigSummary, writeConfigSummary, readRawIniFiles, writeRawIniFiles, saveMods } from '../lib/config'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerConfigHandlers(): void {
  ipcMain.handle(IPC.configRead, (_event, profileId: string) => readConfigSummary(requireProfile(profileId)))

  ipcMain.handle(IPC.configWriteSummary, (_event, profileId: string, summary: ServerConfigSummary) => {
    writeConfigSummary(requireProfile(profileId), summary)
  })

  ipcMain.handle(IPC.configReadRaw, (_event, profileId: string) => readRawIniFiles(requireProfile(profileId)))

  ipcMain.handle(IPC.configWriteRaw, (_event, profileId: string, files: RawIniFiles) => {
    writeRawIniFiles(requireProfile(profileId), files)
  })

  ipcMain.handle(IPC.modsSave, (_event, profileId: string, mods: string[]) => {
    const profile = requireProfile(profileId)
    const updated = { ...profile, activeMods: mods }
    saveMods(updated, mods)
    saveProfile(updated)
    return updated
  })
}
