import { ipcMain } from 'electron'
import { IPC, type ServerMod } from '@shared/types'
import { getProfile, saveProfile } from '../store'
import { saveMods } from '../lib/config'
import { fetchModNames } from '../lib/steamWorkshop'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerModsHandlers(): void {
  ipcMain.handle(IPC.modsSave, (_event, profileId: string, mods: ServerMod[]) => {
    const profile = requireProfile(profileId)
    const updated = { ...profile, mods }
    saveMods(updated, mods)
    saveProfile(updated)
    return updated
  })

  ipcMain.handle(IPC.modsLookupNames, async (_event, ids: string[]) => {
    try {
      return await fetchModNames(ids)
    } catch {
      // Offline, rate-limited, or Steam API hiccup - the UI just falls back to showing IDs.
      return {}
    }
  })
}
