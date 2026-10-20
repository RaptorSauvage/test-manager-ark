import fs from 'node:fs'
import { ipcMain } from 'electron'
import { IPC, type AppSettings, type ClusterImportResult } from '@shared/types'
import { listProfiles, listMinecraftProfiles, saveProfile, saveMinecraftProfile, saveSettings, getSettings } from '../store'
import { serializeClusterBundle, parseClusterBundle } from '../lib/clusterExport'
import { applyBackupSchedule } from '../lib/schedule'
import { applyScheduledRestart, applyScheduledDinoWipe } from '../lib/scheduledActions'
import { applyMinecraftScheduledRestart } from '../lib/minecraftScheduledActions'
import { applyMinecraftBackupSchedule } from '../lib/minecraftBackupSchedule'
import { applyWebDashboardSettings } from '../lib/webDashboard'
import { applyDiscordBotSettings } from '../lib/discordBot'
import { applyLaunchOnStartup } from '../lib/launchOnStartup'
import { applyIniLockSetting } from '../lib/iniLock'

export function registerClusterHandlers(): void {
  ipcMain.handle(IPC.clusterExport, (_event, filePath: string) => {
    fs.writeFileSync(filePath, serializeClusterBundle(), 'utf-8')
  })

  ipcMain.handle(IPC.clusterImport, async (_event, filePath: string, options: { includeSettings: boolean }) => {
    const existing = listProfiles()
    const existingMinecraft = listMinecraftProfiles()
    const bundle = parseClusterBundle(
      fs.readFileSync(filePath, 'utf-8'),
      existing.map((p) => p.name),
      existingMinecraft.map((p) => p.name)
    )

    let profiles = existing
    for (const profile of bundle.profiles) {
      profiles = saveProfile(profile)
      applyBackupSchedule(profile)
      applyScheduledRestart(profile)
      applyScheduledDinoWipe(profile)
    }

    let minecraftProfiles = existingMinecraft
    for (const profile of bundle.minecraftProfiles) {
      minecraftProfiles = saveMinecraftProfile(profile)
      applyMinecraftScheduledRestart(profile)
      applyMinecraftBackupSchedule(profile)
    }

    let settings: AppSettings = getSettings()
    if (options.includeSettings) {
      settings = saveSettings(bundle.settings)
      applyWebDashboardSettings(settings)
      await applyDiscordBotSettings(settings)
      applyLaunchOnStartup(settings)
      applyIniLockSetting(settings.iniLockEnabled, profiles)
    }

    const result: ClusterImportResult = {
      profiles,
      minecraftProfiles,
      settings,
      addedProfileCount: bundle.profiles.length,
      addedMinecraftProfileCount: bundle.minecraftProfiles.length,
      settingsReplaced: options.includeSettings
    }
    return result
  })
}
