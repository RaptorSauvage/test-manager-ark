import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '@shared/types'

/** Backs the custom title bar's own minimize/maximize/close buttons, now that the window runs
 *  frameless (frame: false in main/index.ts) and draws its own themed bar instead of relying
 *  on the OS one. File > Quit reuses the existing IPC.appQuit handler in system.ts. */
export function registerWindowControlsHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC.windowMinimize, () => mainWindow.minimize())
  ipcMain.handle(IPC.windowToggleMaximize, () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  // Goes through the window's own 'close' handler (see createWindow in main/index.ts), same as
  // the native title bar's close button did before - close-to-tray still applies.
  ipcMain.handle(IPC.windowClose, () => mainWindow.close())
  ipcMain.handle(IPC.windowIsMaximized, () => mainWindow.isMaximized())

  const sendMaximizedChanged = (): void => {
    if (!mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(IPC.windowMaximizedChanged, mainWindow.isMaximized())
    }
  }
  mainWindow.on('maximize', sendMaximizedChanged)
  mainWindow.on('unmaximize', sendMaximizedChanged)
}
