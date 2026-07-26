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
  gamePort: number
  queryPort: number
  rconPort: number
  rconPassword: string
  /** Path to the SavedArks folder, relative to installDir */
  savedArksSubPath: string
  /** Directory backups are written to */
  backupDir: string
  /** How many backups to keep per profile before pruning the oldest */
  maxBackups: number
  /** Optional cron expression for automatic backups, e.g. every 6 hours */
  backupSchedule?: string
  /** Steam Workshop mods, in load order. Only enabled mods are passed to the server. */
  mods: ServerMod[]
  /** Free-form extra launch arguments appended to the command line */
  extraArgs: string
}

export interface ServerMod {
  id: string
  /** Workshop title, resolved lazily via the Steam Web API; absent until looked up. */
  name?: string
  enabled: boolean
}

export type ServerRunState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

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

export interface ServerLogLine {
  profileId: string
  stream: 'stdout' | 'stderr' | 'system'
  line: string
  timestamp: number
}

export interface BackupEntry {
  fileName: string
  filePath: string
  createdAt: number
  sizeBytes: number
}

export interface ServerConfigSummary {
  sessionName: string
  serverPassword: string
  serverAdminPassword: string
  maxPlayers: number
  difficultyOffset: number
  xpMultiplier: number
  tamingSpeedMultiplier: number
  harvestAmountMultiplier: number
  pve: boolean
}

export interface RawIniFiles {
  gameUserSettings: string
  game: string
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

  dialogSelectDirectory: 'dialog:select-directory',

  serverStart: 'server:start',
  serverStop: 'server:stop',
  serverRestart: 'server:restart',
  serverStatus: 'server:status',
  serverStatusChanged: 'server:status-changed',
  serverLogLine: 'server:log-line',

  rconSend: 'rcon:send',

  configRead: 'config:read',
  configWriteSummary: 'config:write-summary',
  configReadRaw: 'config:read-raw',
  configWriteRaw: 'config:write-raw',

  modsSave: 'mods:save',
  modsLookupNames: 'mods:lookup-names',

  backupCreate: 'backup:create',
  backupList: 'backup:list',
  backupRestore: 'backup:restore',
  backupDelete: 'backup:delete'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface ImportResult {
  profile: ServerProfile
  profiles: ServerProfile[]
}

/** The contextBridge API surface exposed by the preload script as `window.api`. */
export interface Api {
  profiles: {
    list: () => Promise<ServerProfile[]>
    save: (profile: ServerProfile) => Promise<ServerProfile[]>
    delete: (id: string) => Promise<ServerProfile[]>
    importFromInstall: (installDir: string) => Promise<ImportResult>
  }
  dialog: {
    selectDirectory: () => Promise<string | null>
  }
  server: {
    start: (profileId: string) => Promise<ServerStatus>
    stop: (profileId: string) => Promise<ServerStatus>
    restart: (profileId: string) => Promise<ServerStatus>
    status: (profileId: string) => Promise<ServerStatus>
    onStatusChanged: (callback: (status: ServerStatus) => void) => () => void
    onLogLine: (callback: (line: ServerLogLine) => void) => () => void
  }
  rcon: {
    send: (profileId: string, command: string) => Promise<RconResult>
  }
  config: {
    read: (profileId: string) => Promise<ServerConfigSummary>
    writeSummary: (profileId: string, summary: ServerConfigSummary) => Promise<void>
    readRaw: (profileId: string) => Promise<RawIniFiles>
    writeRaw: (profileId: string, files: RawIniFiles) => Promise<void>
  }
  mods: {
    save: (profileId: string, mods: ServerMod[]) => Promise<ServerProfile>
    lookupNames: (ids: string[]) => Promise<Record<string, string>>
  }
  backup: {
    create: (profileId: string) => Promise<BackupEntry>
    list: (profileId: string) => Promise<BackupEntry[]>
    delete: (filePath: string) => Promise<void>
    restore: (profileId: string, filePath: string) => Promise<void>
  }
}
