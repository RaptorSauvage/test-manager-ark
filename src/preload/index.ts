import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type Api,
  type ServerProfile,
  type ServerStatus,
  type ServerLogLine,
  type ServerMod,
  type AppSettings
} from '@shared/types'

const api: Api = {
  profiles: {
    list: () => ipcRenderer.invoke(IPC.profilesList),
    save: (profile: ServerProfile) => ipcRenderer.invoke(IPC.profilesSave, profile),
    delete: (id: string) => ipcRenderer.invoke(IPC.profilesDelete, id),
    importFromInstall: (installDir: string) => ipcRenderer.invoke(IPC.profilesImport, installDir)
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke(IPC.dialogSelectDirectory),
    selectFile: () => ipcRenderer.invoke(IPC.dialogSelectFile)
  },
  server: {
    start: (profileId: string) => ipcRenderer.invoke(IPC.serverStart, profileId),
    stop: (profileId: string) => ipcRenderer.invoke(IPC.serverStop, profileId),
    restart: (profileId: string) => ipcRenderer.invoke(IPC.serverRestart, profileId),
    kill: (profileId: string) => ipcRenderer.invoke(IPC.serverKill, profileId),
    update: (profileId: string) => ipcRenderer.invoke(IPC.serverUpdate, profileId),
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
  mods: {
    save: (profileId: string, mods: ServerMod[]) => ipcRenderer.invoke(IPC.modsSave, profileId, mods)
  },
  backup: {
    create: (profileId: string) => ipcRenderer.invoke(IPC.backupCreate, profileId),
    list: (profileId: string) => ipcRenderer.invoke(IPC.backupList, profileId),
    delete: (filePath: string) => ipcRenderer.invoke(IPC.backupDelete, filePath),
    restore: (profileId: string, filePath: string) => ipcRenderer.invoke(IPC.backupRestore, profileId, filePath)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (settings: AppSettings) => ipcRenderer.invoke(IPC.settingsSave, settings)
  }
}

contextBridge.exposeInMainWorld('api', api)
