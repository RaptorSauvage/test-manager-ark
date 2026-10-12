import { ipcMain, dialog, type BrowserWindow } from 'electron'
import { IPC } from '@shared/types'

/** Native dialogs are a common trigger for Electron/Windows sometimes failing to return
 *  OS-level keyboard focus to the renderer once they close - the window looks normal
 *  afterward, but every text field silently stops accepting keystrokes until it's
 *  explicitly refocused. Called after every dialog below resolves, regardless of outcome,
 *  as a low-risk belt-and-suspenders fix alongside confirmAction()'s own refocus (which
 *  covers window.confirm(), a real native dialog too, that this file doesn't touch).
 *  mainWindow.focus() alone only gives the window itself OS-level focus - the embedded page
 *  can still report document.hasFocus() === false afterward (confirmed live via DevTools),
 *  which is the actual reason typing silently does nothing; webContents.focus() is what
 *  actually restores it, same fix as system.ts's appFocusWindow. */
function refocus(mainWindow: BrowserWindow): void {
  if (mainWindow.isDestroyed()) return
  mainWindow.focus()
  mainWindow.webContents.focus()
}

export function registerDialogHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC.dialogSelectDirectory, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select the ARK: Survival Ascended server install folder'
    })
    refocus(mainWindow)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.dialogSelectFile, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Select the steamcmd executable'
    })
    refocus(mainWindow)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.dialogSaveProfileFile, async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export server profile',
      defaultPath: `${defaultName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    refocus(mainWindow)
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle(IPC.dialogSelectProfileFile, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Import server profile',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    refocus(mainWindow)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
