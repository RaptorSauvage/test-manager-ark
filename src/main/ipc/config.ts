import { ipcMain } from 'electron'
import { IPC, type ServerConfigSummary, type RawIniFiles } from '@shared/types'
import { getProfile } from '../store'
import { readConfigSummary, writeConfigSummary, readRawIniFiles, writeRawIniFiles } from '../lib/config'

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
}
