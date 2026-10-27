import { app, ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import { getProfile } from '../store'
import {
  openProfilesFolder,
  openDataDirFolder,
  openServerConfigFolder,
  openServerSavedArksFolder,
  openServerSaveGamesFolder
} from '../lib/systemFolders'
import { forceRefocus } from '../lib/windowFocus'

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
  // calls this right after every confirm() as a workaround. See windowFocus.ts's own doc
  // comment for why a plain focus()/webContents.focus() alone wasn't enough on a real repro.
  ipcMain.handle(IPC.appFocusWindow, () => forceRefocus(mainWindow))

  // Same as the tray's own "Quitter" - a real app.quit(), not the window's close-to-tray
  // behavior (see mainWindow.on('close', ...) in main/index.ts).
  ipcMain.handle(IPC.appQuit, () => app.quit())

  // The custom title bar (TitleBar.tsx) replaces Electron's own application menu entirely
  // (Menu.setApplicationMenu(null) in main/index.ts), which also removes the default
  // F12/Ctrl+Shift+I DevTools accelerator that menu normally provides - main/index.ts re-adds
  // the keyboard shortcut directly, but a Tools menu entry is a more discoverable way to get
  // there for diagnosing a rendering bug that can only be seen from the renderer's own
  // console.
  ipcMain.handle(IPC.appOpenDevTools, () => mainWindow.webContents.toggleDevTools())
}
