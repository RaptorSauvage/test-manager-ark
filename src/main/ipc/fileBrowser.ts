import { ipcMain, shell } from 'electron'
import { IPC } from '@shared/types'
import { getProfile } from '../store'
import {
  listFileBrowserEntries,
  resolveFileBrowserPath,
  deleteFileBrowserFile,
  readIniFile,
  writeIniFile,
  listIniHistory,
  diffIniHistoryEntry,
  restoreIniHistoryEntry
} from '../lib/fileBrowser'

function requireInstallDir(profileId: string): string {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile.installDir
}

/** Desktop mirror of the web dashboard's own Files tab routes (webDashboard.ts) - same
 *  fileBrowser.ts logic underneath, over IPC instead of HTTP. ARK only for now, same as the
 *  tab this is wired into (ServerDetail/FilesTab.tsx). */
export function registerFileBrowserHandlers(): void {
  ipcMain.handle(IPC.fileBrowserList, (_event, profileId: string, relativePath: string) =>
    listFileBrowserEntries(requireInstallDir(profileId), relativePath)
  )

  ipcMain.handle(IPC.fileBrowserOpen, async (_event, profileId: string, relativePath: string) => {
    const filePath = resolveFileBrowserPath(requireInstallDir(profileId), relativePath)
    const error = await shell.openPath(filePath)
    if (error) throw new Error(error)
  })

  ipcMain.handle(IPC.fileBrowserDelete, (_event, profileId: string, relativePath: string) =>
    deleteFileBrowserFile(requireInstallDir(profileId), relativePath)
  )

  ipcMain.handle(IPC.fileBrowserReadIni, (_event, profileId: string, relativePath: string) =>
    readIniFile(requireInstallDir(profileId), relativePath)
  )

  ipcMain.handle(IPC.fileBrowserWriteIni, (_event, profileId: string, relativePath: string, content: string) =>
    writeIniFile(profileId, requireInstallDir(profileId), relativePath, content)
  )

  ipcMain.handle(IPC.fileBrowserIniHistory, (_event, profileId: string, relativePath: string) =>
    listIniHistory(profileId, relativePath)
  )

  ipcMain.handle(IPC.fileBrowserIniHistoryDiff, (_event, profileId: string, entryId: string) =>
    diffIniHistoryEntry(profileId, requireInstallDir(profileId), entryId)
  )

  ipcMain.handle(IPC.fileBrowserIniRestore, (_event, profileId: string, entryId: string) =>
    restoreIniHistoryEntry(profileId, requireInstallDir(profileId), entryId)
  )
}
