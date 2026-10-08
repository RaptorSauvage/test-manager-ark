import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getMinecraftProfile } from '../store'
import {
  searchMinecraftMods,
  installMinecraftMod,
  removeMinecraftMod,
  setMinecraftModEnabled,
  checkMinecraftModUpdates,
  updateMinecraftMod,
  scanForInstalledMods,
  openMinecraftModsFolder
} from '../lib/minecraftMods'
import type { MinecraftProfile } from '@shared/minecraft'

function requireProfile(profileId: string): MinecraftProfile {
  const profile = getMinecraftProfile(profileId)
  if (!profile) throw new Error(`Unknown Minecraft profile: ${profileId}`)
  return profile
}

export function registerMinecraftModsHandlers(): void {
  ipcMain.handle(IPC.minecraftModsSearch, (_event, profileId: string, query: string) =>
    searchMinecraftMods(requireProfile(profileId), query)
  )

  ipcMain.handle(IPC.minecraftModsInstall, (_event, profileId: string, projectId: string) =>
    installMinecraftMod(requireProfile(profileId), projectId)
  )

  ipcMain.handle(IPC.minecraftModsRemove, (_event, profileId: string, projectId: string) =>
    removeMinecraftMod(requireProfile(profileId), projectId)
  )

  ipcMain.handle(IPC.minecraftModsSetEnabled, (_event, profileId: string, projectId: string, enabled: boolean) =>
    setMinecraftModEnabled(requireProfile(profileId), projectId, enabled)
  )

  ipcMain.handle(IPC.minecraftModsCheckUpdates, (_event, profileId: string) =>
    checkMinecraftModUpdates(requireProfile(profileId))
  )

  ipcMain.handle(IPC.minecraftModsUpdate, (_event, profileId: string, projectId: string) =>
    updateMinecraftMod(requireProfile(profileId), projectId)
  )

  ipcMain.handle(IPC.minecraftModsScan, (_event, profileId: string) => scanForInstalledMods(requireProfile(profileId)))

  ipcMain.handle(IPC.minecraftModsOpenFolder, (_event, profileId: string) => openMinecraftModsFolder(requireProfile(profileId)))
}
