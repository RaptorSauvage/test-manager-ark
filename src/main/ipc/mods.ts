import { ipcMain } from 'electron'
import { IPC, type ServerMod } from '@shared/types'
import { getProfile, saveProfile } from '../store'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerModsHandlers(): void {
  ipcMain.handle(IPC.modsSave, (_event, profileId: string, mods: ServerMod[]) => {
    const profile = requireProfile(profileId)
    const updated = { ...profile, mods }
    saveProfile(updated)
    return updated
  })
}
