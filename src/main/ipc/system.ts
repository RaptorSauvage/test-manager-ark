import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import { getProfile } from '../store'
import {
  openProfilesFolder,
  openDataDirFolder,
  openServerConfigFolder,
  openServerSavedArksFolder,
  openServerSaveGamesFolder
} from '../lib/systemFolders'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerSystemHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC.appOpenProfilesFolder, () => openProfilesFolder())
  ipcMain.handle(IPC.appOpenDataDirFolder, () => openDataDirFolder())
  ipcMain.handle(IPC.serverOpenConfigFolder, (_event, profileId: string) =>
    openServerConfigFolder(requireProfile(profileId))
  )
  ipcMain.handle(IPC.serverOpenSavedArksFolder, (_event, profileId: string) =>
    openServerSavedArksFolder(requireProfile(profileId))
  )
  ipcMain.handle(IPC.serverOpenSaveGamesFolder, (_event, profileId: string) =>
    openServerSaveGamesFolder(requireProfile(profileId))
  )

  // Electron/Windows sometimes fails to return OS-level keyboard focus to the renderer
  // after a native modal closes - window.confirm()/window.alert() (a real native dialog in
  // Electron, not an in-page one) and the file/folder pickers in dialog.ts are both real
  // examples. When that happens, every text field afterward still looks normal (not
  // disabled, still visually focusable) but silently stops accepting keystrokes until the
  // window is explicitly refocused - confirmAction() (src/renderer/src/lib/confirmAction.ts)
  // calls this right after every confirm() as a workaround.
  ipcMain.handle(IPC.appFocusWindow, () => {
    if (!mainWindow.isDestroyed()) mainWindow.focus()
  })
}
