import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getProfile } from '../store'
import { openProfilesFolder, openServerConfigFolder } from '../lib/systemFolders'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerSystemHandlers(): void {
  ipcMain.handle(IPC.appOpenProfilesFolder, () => openProfilesFolder())
  ipcMain.handle(IPC.serverOpenConfigFolder, (_event, profileId: string) =>
    openServerConfigFolder(requireProfile(profileId))
  )
}
