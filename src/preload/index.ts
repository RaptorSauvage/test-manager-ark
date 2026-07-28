import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type Api, type ServerProfile, type ServerStatus, type ServerMod, type AppSettings } from '@shared/types'

const api: Api = {
  profiles: {
    list: () => ipcRenderer.invoke(IPC.profilesList),
    save: (profile: ServerProfile) => ipcRenderer.invoke(IPC.profilesSave, profile),
    delete: (id: string) => ipcRenderer.invoke(IPC.profilesDelete, id),
    importFromInstall: (installDir: string) => ipcRenderer.invoke(IPC.profilesImport, installDir),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke(IPC.profilesReorder, orderedIds),
    export: (profileId: string, filePath: string) => ipcRenderer.invoke(IPC.profilesExport, profileId, filePath),
    importFromFile: (filePath: string) => ipcRenderer.invoke(IPC.profilesImportFromFile, filePath)
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke(IPC.dialogSelectDirectory),
    selectFile: () => ipcRenderer.invoke(IPC.dialogSelectFile),
    saveProfileFile: (defaultName: string) => ipcRenderer.invoke(IPC.dialogSaveProfileFile, defaultName),
    selectProfileFile: () => ipcRenderer.invoke(IPC.dialogSelectProfileFile),
    saveModsFile: (defaultName: string) => ipcRenderer.invoke(IPC.dialogSaveModsFile, defaultName),
    selectModsFile: () => ipcRenderer.invoke(IPC.dialogSelectModsFile)
  },
  server: {
    start: (profileId: string) => ipcRenderer.invoke(IPC.serverStart, profileId),
    stop: (profileId: string) => ipcRenderer.invoke(IPC.serverStop, profileId),
    restart: (profileId: string) => ipcRenderer.invoke(IPC.serverRestart, profileId),
    kill: (profileId: string) => ipcRenderer.invoke(IPC.serverKill, profileId),
    update: (profileId: string) => ipcRenderer.invoke(IPC.serverUpdate, profileId),
    isInstalled: (profileId: string) => ipcRenderer.invoke(IPC.serverIsInstalled, profileId),
    status: (profileId: string) => ipcRenderer.invoke(IPC.serverStatus, profileId),
    onStatusChanged: (callback: (status: ServerStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: ServerStatus): void => callback(status)
      ipcRenderer.on(IPC.serverStatusChanged, listener)
      return () => ipcRenderer.removeListener(IPC.serverStatusChanged, listener)
    },
    getInstalledBuildId: (profileId: string) => ipcRenderer.invoke(IPC.serverGetInstalledBuildId, profileId)
  },
  mods: {
    save: (profileId: string, mods: ServerMod[]) => ipcRenderer.invoke(IPC.modsSave, profileId, mods),
    exportToFile: (filePath: string, mods: ServerMod[]) => ipcRenderer.invoke(IPC.modsExport, filePath, mods),
    importFromFile: (filePath: string) => ipcRenderer.invoke(IPC.modsImportFromFile, filePath)
  },
  backup: {
    create: (profileId: string) => ipcRenderer.invoke(IPC.backupCreate, profileId),
    list: (profileId: string) => ipcRenderer.invoke(IPC.backupList, profileId),
    delete: (filePath: string) => ipcRenderer.invoke(IPC.backupDelete, filePath),
    restore: (profileId: string, filePath: string) => ipcRenderer.invoke(IPC.backupRestore, profileId, filePath),
    openFolder: (profileId: string) => ipcRenderer.invoke(IPC.backupOpenFolder, profileId),
    onCreated: (callback: (profileId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, profileId: string): void => callback(profileId)
      ipcRenderer.on(IPC.backupCreated, listener)
      return () => ipcRenderer.removeListener(IPC.backupCreated, listener)
    },
    getScheduleStatus: (profileId: string) => ipcRenderer.invoke(IPC.backupScheduleStatus, profileId)
  },
  playerBackup: {
    listFolders: (profileId: string) => ipcRenderer.invoke(IPC.playerBackupFoldersList, profileId),
    list: (profileId: string, folderKey: string) => ipcRenderer.invoke(IPC.playerBackupList, profileId, folderKey),
    openFolder: (profileId: string, folderKey: string) =>
      ipcRenderer.invoke(IPC.playerBackupOpenFolder, profileId, folderKey)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (settings: AppSettings) => ipcRenderer.invoke(IPC.settingsSave, settings)
  },
  steamcmd: {
    install: () => ipcRenderer.invoke(IPC.steamcmdInstall),
    managedStatus: () => ipcRenderer.invoke(IPC.steamcmdManagedStatus),
    getUpdateLog: (profileId: string) => ipcRenderer.invoke(IPC.steamcmdUpdateLog, profileId),
    addFirewallRule: (steamCmdPath: string) => ipcRenderer.invoke(IPC.steamcmdAddFirewallRule, steamCmdPath)
  },
  maps: {
    list: () => ipcRenderer.invoke(IPC.mapsList)
  },
  customMaps: {
    list: () => ipcRenderer.invoke(IPC.customMapsList)
  },
  dataDir: {
    getDefault: () => ipcRenderer.invoke(IPC.dataDirGetDefault)
  },
  officialServerStatus: {
    get: () => ipcRenderer.invoke(IPC.officialServerStatusGet)
  },
  webDashboard: {
    getStatus: () => ipcRenderer.invoke(IPC.webDashboardStatus),
    getLocalIps: () => ipcRenderer.invoke(IPC.webDashboardLocalIps)
  },
  system: {
    openProfilesFolder: () => ipcRenderer.invoke(IPC.appOpenProfilesFolder),
    openServerConfigFolder: (profileId: string) => ipcRenderer.invoke(IPC.serverOpenConfigFolder, profileId)
  }
}

contextBridge.exposeInMainWorld('api', api)
