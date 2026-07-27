// Types shared between the Electron main process, the preload bridge and the
// React renderer. Keeping a single source of truth here avoids the two sides
// of the IPC boundary drifting apart.

export interface ServerProfile {
  id: string
  name: string
  /** Root install directory, containing ShooterGame/Binaries/... */
  installDir: string
  /** Map identifier passed on the command line, e.g. "TheIsland_WP" */
  map: string
  /** Whether a modded map overrides the map above */
  moddedMapEnabled: boolean
  /** Workshop mod id for the modded map, passed as -MapModID=<id> when moddedMapEnabled */
  moddedMapId: string
  gamePort: number
  rconPort: number
  /** Crossplay setting passed as -ServerPlatform=<value> */
  serverPlatform: 'PC' | 'ALL'
  /** Passed as -WinLiveMaxPlayers=<n> */
  maxPlayers: number
  /** Directory backups are written to */
  backupDir: string
  /** How many backups to keep per profile before pruning the oldest */
  maxBackups: number
  /** Optional cron expression for automatic backups, e.g. every 6 hours */
  backupSchedule?: string
  /** Whether the cron schedule above is actually active */
  backupScheduleEnabled: boolean
  /**
   * Mods, in load order. Only enabled mods are passed via the server's
   * `-mods=` launch flag (ARK:SA does not use Steam Workshop or
   * GameUserSettings.ini for mods - the launch flag is the only mechanism).
   */
  mods: ServerMod[]
  /** Whether the cluster options below are actually applied at launch */
  clusterEnabled: boolean
  /** Passed as -clusterid=<id> when clusterEnabled */
  clusterId: string
  /** Passed as -ClusterDirOverride=<path> when clusterEnabled and non-empty */
  clusterDirOverride: string
  /** Passed as -NoTransferFromFiltering when clusterEnabled */
  noTransferFromFiltering: boolean
  /** Passed as -ServerIP=<ip> when clusterEnabled and non-empty */
  externalIp: string
  /** Passed as -culture=<value> when not 'none' */
  cultureSettings: 'none' | 'en' | 'fr'
  /** Passed as -NoBattlEye when true */
  disableBattlEye: boolean
  /** Passed as -servergamelogincludetribelogs -ServerRCONOutputTribeLogs when true */
  rconTribeLog: boolean
  /** Passed as -ForceRespawnDinos when true */
  forceRespawnDinos: boolean
  /** Passed as -nosound when true */
  noSound: boolean
  /** Free-form extra launch arguments appended to the command line */
  extraArgs: string
}

export interface MapDefinition {
  /** Internal map identifier passed on the command line, e.g. "TheIsland_WP" */
  id: string
  /** Human-readable label shown in the map selector */
  displayName: string
}

export interface ServerMod {
  id: string
  /** User-supplied label, purely cosmetic - not looked up automatically. */
  name?: string
  enabled: boolean
  /** When true, the id is passed as "<id>-dev" so ARK loads the mod's in-development build. */
  dev: boolean
}

export type ServerRunState = 'stopped' | 'starting' | 'running' | 'stopping' | 'restarting' | 'updating' | 'error'

export interface AppSettings {
  /** Path to the steamcmd executable (steamcmd.exe on Windows, steamcmd.sh on Linux). */
  steamCmdPath: string
  /**
   * Base folder for editable JSON config files (maps.json, customMaps.json, and any future
   * ones). Empty means "use the default" (Documents/ARK Server Manager).
   */
  dataDir: string
}

export interface ServerStatus {
  profileId: string
  state: ServerRunState
  pid?: number
  startedAt?: number
  cpu?: number
  memoryMB?: number
  players?: string[]
  lastError?: string
}

export interface BackupEntry {
  fileName: string
  filePath: string
  createdAt: number
  sizeBytes: number
}

export interface RconResult {
  ok: boolean
  response?: string
  error?: string
}

export const IPC = {
  profilesList: 'profiles:list',
  profilesSave: 'profiles:save',
  profilesDelete: 'profiles:delete',
  profilesImport: 'profiles:import',
  profilesReorder: 'profiles:reorder',
  profilesExport: 'profiles:export',
  profilesImportFromFile: 'profiles:import-from-file',

  dialogSelectDirectory: 'dialog:select-directory',
  dialogSelectFile: 'dialog:select-file',
  dialogSaveProfileFile: 'dialog:save-profile-file',
  dialogSelectProfileFile: 'dialog:select-profile-file',

  serverStart: 'server:start',
  serverStop: 'server:stop',
  serverRestart: 'server:restart',
  serverKill: 'server:kill',
  serverUpdate: 'server:update',
  serverIsInstalled: 'server:is-installed',
  serverStatus: 'server:status',
  serverStatusChanged: 'server:status-changed',

  rconSend: 'rcon:send',

  modsSave: 'mods:save',

  backupCreate: 'backup:create',
  backupList: 'backup:list',
  backupRestore: 'backup:restore',
  backupDelete: 'backup:delete',

  settingsGet: 'settings:get',
  settingsSave: 'settings:save',

  steamcmdInstall: 'steamcmd:install',
  steamcmdManagedStatus: 'steamcmd:managed-status',
  steamcmdUpdateLog: 'steamcmd:update-log',
  steamcmdAddFirewallRule: 'steamcmd:add-firewall-rule',

  mapsList: 'maps:list',
  customMapsList: 'custom-maps:list',
  dataDirGetDefault: 'data-dir:get-default',

  officialServerStatusGet: 'official-server-status:get'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface ImportResult {
  profile: ServerProfile
  profiles: ServerProfile[]
}

/** Official ARK:SA server status feed, parsed from its "<RichColor>" formatted line. */
export interface OfficialServerStatus {
  /** e.g. "ARK Official Server Network Status" */
  label: string
  /** e.g. "Online" */
  status: string
  /** e.g. "92.25" */
  version: string
  /** CSS rgb()/rgba() color converted from the feed's 0-1 float RichColor */
  color: string
}

/** The contextBridge API surface exposed by the preload script as `window.api`. */
export interface Api {
  profiles: {
    list: () => Promise<ServerProfile[]>
    save: (profile: ServerProfile) => Promise<ServerProfile[]>
    delete: (id: string) => Promise<ServerProfile[]>
    importFromInstall: (installDir: string) => Promise<ImportResult>
    reorder: (orderedIds: string[]) => Promise<ServerProfile[]>
    export: (profileId: string, filePath: string) => Promise<void>
    importFromFile: (filePath: string) => Promise<ImportResult>
  }
  dialog: {
    selectDirectory: () => Promise<string | null>
    selectFile: () => Promise<string | null>
    saveProfileFile: (defaultName: string) => Promise<string | null>
    selectProfileFile: () => Promise<string | null>
  }
  server: {
    start: (profileId: string) => Promise<ServerStatus>
    stop: (profileId: string) => Promise<ServerStatus>
    restart: (profileId: string) => Promise<ServerStatus>
    kill: (profileId: string) => Promise<ServerStatus>
    update: (profileId: string) => Promise<void>
    isInstalled: (profileId: string) => Promise<boolean>
    status: (profileId: string) => Promise<ServerStatus>
    onStatusChanged: (callback: (status: ServerStatus) => void) => () => void
  }
  rcon: {
    send: (profileId: string, command: string) => Promise<RconResult>
  }
  mods: {
    save: (profileId: string, mods: ServerMod[]) => Promise<ServerProfile>
  }
  backup: {
    create: (profileId: string) => Promise<BackupEntry>
    list: (profileId: string) => Promise<BackupEntry[]>
    delete: (filePath: string) => Promise<void>
    restore: (profileId: string, filePath: string) => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (settings: AppSettings) => Promise<AppSettings>
  }
  steamcmd: {
    install: () => Promise<string>
    managedStatus: () => Promise<string | null>
    getUpdateLog: (profileId: string) => Promise<string | null>
    addFirewallRule: (steamCmdPath: string) => Promise<void>
  }
  maps: {
    list: () => Promise<MapDefinition[]>
  }
  customMaps: {
    list: () => Promise<MapDefinition[]>
  }
  dataDir: {
    getDefault: () => Promise<string>
  }
  officialServerStatus: {
    get: () => Promise<OfficialServerStatus>
  }
}
