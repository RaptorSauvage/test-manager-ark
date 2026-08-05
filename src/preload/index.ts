import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type Api,
  type ServerProfile,
  type ServerStatus,
  type ServerMod,
  type AppSettings,
  type AppUpdateStatus,
  type BackupLogEntry,
  type WebDashboardRole
} from '@shared/types'

const api: Api = {
  profiles: {
    list: () => ipcRenderer.invoke(IPC.profilesList),
    save: (profile: ServerProfile) => ipcRenderer.invoke(IPC.profilesSave, profile),
    delete: (id: string) => ipcRenderer.invoke(IPC.profilesDelete, id),
    importFromInstall: (installDir: string) => ipcRenderer.invoke(IPC.profilesImport, installDir),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke(IPC.profilesReorder, orderedIds),
    export: (profileId: string, filePath: string) => ipcRenderer.invoke(IPC.profilesExport, profileId, filePath),
    importFromFile: (filePath: string) => ipcRenderer.invoke(IPC.profilesImportFromFile, filePath),
    copy: (profileId: string, destInstallDir: string, newName: string) =>
      ipcRenderer.invoke(IPC.profilesCopy, profileId, destInstallDir, newName),
    move: (profileId: string, destInstallDir: string, newName: string) =>
      ipcRenderer.invoke(IPC.profilesMove, profileId, destInstallDir, newName)
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
    getScheduleStatus: (profileId: string) => ipcRenderer.invoke(IPC.backupScheduleStatus, profileId),
    getLog: (profileId: string) => ipcRenderer.invoke(IPC.backupLogGet, profileId),
    onLogChanged: (callback: (profileId: string, entry: BackupLogEntry) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, profileId: string, entry: BackupLogEntry): void =>
        callback(profileId, entry)
      ipcRenderer.on(IPC.backupLogChanged, listener)
      return () => ipcRenderer.removeListener(IPC.backupLogChanged, listener)
    }
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
    onUpdateLogChanged: (callback: (profileId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, profileId: string): void => callback(profileId)
      ipcRenderer.on(IPC.steamcmdUpdateLogChanged, listener)
      return () => ipcRenderer.removeListener(IPC.steamcmdUpdateLogChanged, listener)
    },
    addFirewallRule: (steamCmdPath: string) => ipcRenderer.invoke(IPC.steamcmdAddFirewallRule, steamCmdPath),
    getLatestBuildId: () => ipcRenderer.invoke(IPC.steamcmdLatestBuildId)
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
  webDashboardAccounts: {
    list: () => ipcRenderer.invoke(IPC.webDashboardAccountsList),
    create: (username: string, password: string, role: WebDashboardRole) =>
      ipcRenderer.invoke(IPC.webDashboardAccountsCreate, username, password, role),
    setRole: (id: string, role: WebDashboardRole) => ipcRenderer.invoke(IPC.webDashboardAccountsSetRole, id, role),
    resetPassword: (id: string, newPassword: string) =>
      ipcRenderer.invoke(IPC.webDashboardAccountsResetPassword, id, newPassword),
    delete: (id: string) => ipcRenderer.invoke(IPC.webDashboardAccountsDelete, id)
  },
  system: {
    openProfilesFolder: () => ipcRenderer.invoke(IPC.appOpenProfilesFolder),
    openServerConfigFolder: (profileId: string) => ipcRenderer.invoke(IPC.serverOpenConfigFolder, profileId)
  },
  mapManagement: {
    list: (profileId: string) => ipcRenderer.invoke(IPC.mapManagementList, profileId),
    create: (profileId: string, folderName: string, fileName: string) =>
      ipcRenderer.invoke(IPC.mapManagementCreate, profileId, folderName, fileName),
    delete: (profileId: string, folderName: string) => ipcRenderer.invoke(IPC.mapManagementDelete, profileId, folderName),
    openFolder: (profileId: string, folderName: string) =>
      ipcRenderer.invoke(IPC.mapManagementOpenFolder, profileId, folderName)
  },
  appUpdate: {
    getVersion: () => ipcRenderer.invoke(IPC.appUpdateGetVersion),
    check: () => ipcRenderer.invoke(IPC.appUpdateCheck),
    install: () => ipcRenderer.invoke(IPC.appUpdateInstall),
    getStatus: () => ipcRenderer.invoke(IPC.appUpdateStatus),
    onStatusChanged: (callback: (status: AppUpdateStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus): void => callback(status)
      ipcRenderer.on(IPC.appUpdateStatusChanged, listener)
      return () => ipcRenderer.removeListener(IPC.appUpdateStatusChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
