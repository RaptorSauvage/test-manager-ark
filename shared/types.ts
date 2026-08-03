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
   * When true, backs up a player's .arkprofile file (from SavedArks/<map>) into a
   * dedicated per-player folder under the backup directory whenever the server's own
   * log shows them joining or leaving - detected by tailing ShooterGame.log, not RCON
   * polling.
   */
  playerProfileBackupEnabled: boolean
  /** How many of the snapshots above to keep per player before pruning the oldest */
  playerProfileBackupMaxPerPlayer: number
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
  /**
   * Scheduled restart: gracefully stops the server at `scheduledRestartTime` on the
   * selected days, optionally updates it via SteamCMD and/or starts it back up.
   */
  scheduledRestartEnabled: boolean
  /** 24h "HH:MM" */
  scheduledRestartTime: string
  /** Days it fires on, 0=Sunday..6=Saturday */
  scheduledRestartDays: number[]
  scheduledRestartUpdateAfter: boolean
  scheduledRestartStartAfter: boolean
  /** Scheduled dino wipe - independent of the restart above: sends RCON DestroyWildDinos
   *  at `scheduledDinoWipeTime` on the selected days, while the server is running. */
  scheduledDinoWipeEnabled: boolean
  /** 24h "HH:MM" */
  scheduledDinoWipeTime: string
  /** Days it fires on, 0=Sunday..6=Saturday */
  scheduledDinoWipeDays: number[]
  /** When true, hidden from the main dashboard grid (and bulk "...All" actions) without
   *  deleting it or touching whatever server process is actually running - just a way to
   *  declutter the main list for a profile you're not actively using right now. */
  hidden: boolean
  /** Free-form dashboard grouping label. Empty (the default) means "no group" - shown
   *  directly in the main grid. Any other value collects every profile sharing it into
   *  its own collapsible section on the dashboard, named after the group. */
  group: string
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
  /** When true, the id is passed via -passivemods= instead of -mods=. */
  passive: boolean
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
  /** Whether the local browser-accessible web dashboard (live console + RCON) is running. */
  webDashboardEnabled: boolean
  /** Port the web dashboard listens on. */
  webDashboardPort: number
  /**
   * Interface the web dashboard binds to. '127.0.0.1' (default) - this machine only.
   * '0.0.0.0' or a specific local IP makes it reachable from other devices on the LAN -
   * there's no login of its own, so that's a deliberate, explicit choice.
   */
  webDashboardHost: string
  /** Event labels (JOIN, CHAT, ...) hidden from the web dashboard's live feed. */
  webDashboardDisabledLabels: string[]
  /** Whether the Manager registers itself to launch automatically when you log into
   *  Windows (or the equivalent on macOS/Linux), via Electron's own login-item API. */
  launchOnStartup: boolean
}

export interface ServerStatus {
  profileId: string
  state: ServerRunState
  pid?: number
  startedAt?: number
  cpu?: number
  memoryMB?: number
  memoryPercent?: number
  players?: string[]
  lastError?: string
}

export interface BackupEntry {
  fileName: string
  filePath: string
  createdAt: number
  sizeBytes: number
}

/** One step of a backup's SaveGame -> settle -> zip sequence, for the Backups tab's
 *  process log - so a scheduled/automatic backup (which nobody's watching happen) can
 *  still be monitored/debugged after the fact instead of being a black box. */
export interface BackupLogEntry {
  timestamp: number
  level: 'info' | 'error'
  message: string
}

/** One subfolder directly under SavedArks - for the Settings tab's Map Management section,
 *  which browses/creates/deletes them (e.g. to pre-create a custom map's empty save folder
 *  before its mod is installed). */
export interface MapFolderEntry {
  name: string
  createdAt: number
}

/** For the Analytics tab's "Backup Status" panel. */
export interface BackupScheduleStatus {
  /** Whether the schedule is actually running right now (enabled, valid cron, applied). */
  active: boolean
  /** Epoch ms of the next scheduled run, or null if inactive/unparseable. */
  nextRunAt: number | null
}

/** Polled every 30 minutes from SteamCMD (anonymous, no download) for the Analytics tab's
 *  "update available" check - see src/main/lib/updateCheck.ts. */
export interface LatestBuildIdCache {
  buildId: string | null
  /** When that value was captured (epoch ms), or null before the first check. */
  checkedAt: number | null
  /** The last check's failure, if the most recent attempt didn't produce a build id. */
  error: string | null
}

/** Progress of a Manager self-update, driven by electron-updater against this repo's
 *  GitHub Releases - see src/main/lib/appUpdater.ts. Pushed to the renderer as it changes
 *  so the Settings button can show live status instead of just the final result. */
export interface AppUpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  /** The update's version, once known (from 'available' onward). */
  version?: string
  /** Download progress 0-100, while state is 'downloading'. */
  percent?: number
  error?: string
}

/** One player's backup folder, for a "pick a player" selector next to the world backup list. */
export interface PlayerBackupFolder {
  /** Raw folder name - pass back to playerBackup.list/openFolder as-is. */
  key: string
  playerName: string
  uniqueNetId: string
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
  profilesCopy: 'profiles:copy',
  profilesMove: 'profiles:move',

  dialogSelectDirectory: 'dialog:select-directory',
  dialogSelectFile: 'dialog:select-file',
  dialogSaveProfileFile: 'dialog:save-profile-file',
  dialogSelectProfileFile: 'dialog:select-profile-file',
  dialogSaveModsFile: 'dialog:save-mods-file',
  dialogSelectModsFile: 'dialog:select-mods-file',

  serverStart: 'server:start',
  serverStop: 'server:stop',
  serverRestart: 'server:restart',
  serverKill: 'server:kill',
  serverUpdate: 'server:update',
  serverIsInstalled: 'server:is-installed',
  serverStatus: 'server:status',
  serverStatusChanged: 'server:status-changed',
  serverGetInstalledBuildId: 'server:get-installed-build-id',

  modsSave: 'mods:save',
  modsExport: 'mods:export',
  modsImportFromFile: 'mods:import-from-file',

  backupCreate: 'backup:create',
  backupList: 'backup:list',
  backupRestore: 'backup:restore',
  backupDelete: 'backup:delete',
  backupOpenFolder: 'backup:open-folder',
  backupCreated: 'backup:created',
  backupScheduleStatus: 'backup:schedule-status',
  backupLogGet: 'backup:log-get',
  backupLogChanged: 'backup:log-changed',

  playerBackupFoldersList: 'player-backup:folders-list',
  playerBackupList: 'player-backup:list',
  playerBackupOpenFolder: 'player-backup:open-folder',

  settingsGet: 'settings:get',
  settingsSave: 'settings:save',

  steamcmdInstall: 'steamcmd:install',
  steamcmdManagedStatus: 'steamcmd:managed-status',
  steamcmdUpdateLog: 'steamcmd:update-log',
  steamcmdAddFirewallRule: 'steamcmd:add-firewall-rule',
  steamcmdLatestBuildId: 'steamcmd:latest-build-id',

  mapsList: 'maps:list',
  customMapsList: 'custom-maps:list',
  dataDirGetDefault: 'data-dir:get-default',

  officialServerStatusGet: 'official-server-status:get',

  webDashboardStatus: 'web-dashboard:status',
  webDashboardLocalIps: 'web-dashboard:local-ips',

  appOpenProfilesFolder: 'app:open-profiles-folder',
  serverOpenConfigFolder: 'server:open-config-folder',

  mapManagementList: 'map-management:list',
  mapManagementCreate: 'map-management:create',
  mapManagementDelete: 'map-management:delete',
  mapManagementOpenFolder: 'map-management:open-folder',

  appUpdateGetVersion: 'app-update:get-version',
  appUpdateCheck: 'app-update:check',
  appUpdateInstall: 'app-update:install',
  appUpdateStatus: 'app-update:status',
  appUpdateStatusChanged: 'app-update:status-changed'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface ImportResult {
  profile: ServerProfile
  profiles: ServerProfile[]
}

/** A single classified, human-readable line parsed out of a server's ShooterGame.log. */
export interface LogEvent {
  /** Short uppercase category, e.g. "JOIN", "CHAT", "KILL" - drives the CSS class/color. */
  label: string
  /** Lowercase CSS class suffix (log-event-<cls>) matching `label`. */
  cls: string
  /** Human-readable, already-formatted display text. */
  text: string
  /** Local time the line was logged, "HH:MM:SS". */
  ts: string
}

/**
 * Invisible markers wrapping a player's name inside a JOIN/LEFT LogEvent's `text`, so the
 * UI can color just that portion (the rest of the line stays the default text color)
 * without having to guess where a name starts/ends. Shared between the parser (main) and
 * the renderers (React tab + web dashboard page) that both need to strip them back out
 * while building the DOM. Never rendered as literal characters.
 */
export const PLAYER_NAME_OPEN = '\u0001'
export const PLAYER_NAME_CLOSE = '\u0002'

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
    copy: (profileId: string, destInstallDir: string, newName: string) => Promise<ImportResult>
    move: (profileId: string, destInstallDir: string, newName: string) => Promise<ImportResult>
  }
  dialog: {
    selectDirectory: () => Promise<string | null>
    selectFile: () => Promise<string | null>
    saveProfileFile: (defaultName: string) => Promise<string | null>
    selectProfileFile: () => Promise<string | null>
    saveModsFile: (defaultName: string) => Promise<string | null>
    selectModsFile: () => Promise<string | null>
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
    getInstalledBuildId: (profileId: string) => Promise<string | null>
  }
  mods: {
    save: (profileId: string, mods: ServerMod[]) => Promise<ServerProfile>
    exportToFile: (filePath: string, mods: ServerMod[]) => Promise<void>
    importFromFile: (filePath: string) => Promise<ServerMod[]>
  }
  backup: {
    create: (profileId: string) => Promise<BackupEntry>
    list: (profileId: string) => Promise<BackupEntry[]>
    delete: (filePath: string) => Promise<void>
    restore: (profileId: string, filePath: string) => Promise<void>
    openFolder: (profileId: string) => Promise<void>
    onCreated: (callback: (profileId: string) => void) => () => void
    getScheduleStatus: (profileId: string) => Promise<BackupScheduleStatus>
    getLog: (profileId: string) => Promise<BackupLogEntry[]>
    onLogChanged: (callback: (profileId: string, entry: BackupLogEntry) => void) => () => void
  }
  playerBackup: {
    listFolders: (profileId: string) => Promise<PlayerBackupFolder[]>
    list: (profileId: string, folderKey: string) => Promise<BackupEntry[]>
    openFolder: (profileId: string, folderKey: string) => Promise<void>
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
    getLatestBuildId: () => Promise<LatestBuildIdCache>
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
  webDashboard: {
    getStatus: () => Promise<{ running: boolean; error: string | null; host: string | null }>
    getLocalIps: () => Promise<string[]>
  }
  system: {
    openProfilesFolder: () => Promise<void>
    openServerConfigFolder: (profileId: string) => Promise<void>
  }
  mapManagement: {
    list: (profileId: string) => Promise<MapFolderEntry[]>
    create: (profileId: string, folderName: string, fileName: string) => Promise<void>
    delete: (profileId: string, folderName: string) => Promise<void>
    openFolder: (profileId: string, folderName: string) => Promise<void>
  }
  appUpdate: {
    getVersion: () => Promise<string>
    check: () => Promise<void>
    install: () => Promise<void>
    getStatus: () => Promise<AppUpdateStatus>
    onStatusChanged: (callback: (status: AppUpdateStatus) => void) => () => void
  }
}
