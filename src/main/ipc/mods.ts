import fs from 'node:fs'
import { ipcMain } from 'electron'
import { IPC, type ServerMod } from '@shared/types'
import { getProfile, saveProfile } from '../store'
import { serializeMods, parseImportedMods } from '../lib/modsExport'

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

  ipcMain.handle(IPC.modsExport, (_event, filePath: string, mods: ServerMod[]) => {
    fs.writeFileSync(filePath, serializeMods(mods), 'utf-8')
  })

  ipcMain.handle(IPC.modsImportFromFile, (_event, filePath: string) => parseImportedMods(fs.readFileSync(filePath, 'utf-8')))
}
