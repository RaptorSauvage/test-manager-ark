import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type Api,
  type ServerProfile,
  type ServerConfigSummary,
  type RawIniFiles,
  type ServerStatus,
  type ServerLogLine
} from '@shared/types'

const api: Api = {
  profiles: {
    list: () => ipcRenderer.invoke(IPC.profilesList),
    save: (profile: ServerProfile) => ipcRenderer.invoke(IPC.profilesSave, profile),
    delete: (id: string) => ipcRenderer.invoke(IPC.profilesDelete, id),
    importFromInstall: (installDir: string) => ipcRenderer.invoke(IPC.profilesImport, installDir)
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke(IPC.dialogSelectDirectory)
  },
  server: {
    start: (profileId: string) => ipcRenderer.invoke(IPC.serverStart, profileId),
    stop: (profileId: string) => ipcRenderer.invoke(IPC.serverStop, profileId),
    restart: (profileId: string) => ipcRenderer.invoke(IPC.serverRestart, profileId),
    status: (profileId: string) => ipcRenderer.invoke(IPC.serverStatus, profileId),
    onStatusChanged: (callback: (status: ServerStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: ServerStatus): void => callback(status)
      ipcRenderer.on(IPC.serverStatusChanged, listener)
      return () => ipcRenderer.removeListener(IPC.serverStatusChanged, listener)
    },
    onLogLine: (callback: (line: ServerLogLine) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, line: ServerLogLine): void => callback(line)
      ipcRenderer.on(IPC.serverLogLine, listener)
      return () => ipcRenderer.removeListener(IPC.serverLogLine, listener)
    }
  },
  rcon: {
    send: (profileId: string, command: string) => ipcRenderer.invoke(IPC.rconSend, profileId, command)
  },
  config: {
    read: (profileId: string) => ipcRenderer.invoke(IPC.configRead, profileId),
    writeSummary: (profileId: string, summary: ServerConfigSummary) =>
      ipcRenderer.invoke(IPC.configWriteSummary, profileId, summary),
    readRaw: (profileId: string) => ipcRenderer.invoke(IPC.configReadRaw, profileId),
    writeRaw: (profileId: string, files: RawIniFiles) => ipcRenderer.invoke(IPC.configWriteRaw, profileId, files),
    saveMods: (profileId: string, mods: string[]) => ipcRenderer.invoke(IPC.modsSave, profileId, mods)
  },
  backup: {
    create: (profileId: string) => ipcRenderer.invoke(IPC.backupCreate, profileId),
    list: (profileId: string) => ipcRenderer.invoke(IPC.backupList, profileId),
    delete: (filePath: string) => ipcRenderer.invoke(IPC.backupDelete, filePath),
    restore: (profileId: string, filePath: string) => ipcRenderer.invoke(IPC.backupRestore, profileId, filePath)
  }
}

contextBridge.exposeInMainWorld('api', api)
