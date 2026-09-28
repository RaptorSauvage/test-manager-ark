import { ipcMain } from 'electron'
import { IPC, type ServerMod } from '@shared/types'
import { getProfile, saveProfile } from '../store'
import { parseImportedMods } from '../lib/modsExport'
import { syncAseModsToIni } from '../lib/gameConfigWrite'

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
    // ARK: Survival Evolved has no command-line mechanism for mods - this is the only thing
    // that actually applies a Mods tab change for it (a no-op for ARK: Survival Ascended).
    syncAseModsToIni(updated)
    return updated
  })

  ipcMain.handle(IPC.modsParseText, (_event, text: string) => parseImportedMods(text))
}
