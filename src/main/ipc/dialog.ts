import { ipcMain, dialog, type BrowserWindow } from 'electron'
import { IPC } from '@shared/types'

export function registerDialogHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC.dialogSelectDirectory, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select the ARK: Survival Ascended server install folder'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
