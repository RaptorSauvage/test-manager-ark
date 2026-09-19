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

  ipcMain.handle(IPC.dialogSelectFile, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Select the steamcmd executable'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.dialogSaveProfileFile, async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export server profile',
      defaultPath: `${defaultName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle(IPC.dialogSelectProfileFile, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Import server profile',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
