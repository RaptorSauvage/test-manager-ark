// Types shared between the Electron main process, the preload bridge and the
// React renderer. Keeping a single source of truth here avoids the two sides
// of the IPC boundary drifting apart.

export interface ServerProfile {
  id: string
  name: string
  /** Root install directory, containing ShooterGame/Binaries/... */
  installDir: string
  /** Whether the SteamCMD update/install below targets a beta branch instead of the
   *  default/public one. */
  steamBetaEnabled: boolean
  /** Beta branch name, passed as `-beta <name>` right before `validate` in the SteamCMD
   *  update command when steamBetaEnabled is on. */
  steamBetaName: string
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
  /** Anti-crash watchdog: when a server that was running is found stopped without ever
   *  passing through a deliberate `stopping`/`restarting` state first (i.e. a confirmed,
   *  unexpected crash - see handleUnexpectedExit in serverProcess.ts), restart it
   *  automatically after a short delay. Deliberate Stop/Kill/Restart/Update/scheduled
   *  restart are never mistaken for a crash, since each of those always sets `stopping` or
   *  `restarting` before touching the process. Independent per profile. */
  crashWatchEnabled: boolean
  /** Zombie detection: active only during the `starting` phase (from the process spawning
   *  until the startup-complete log marker confirms `running`, or the server otherwise
   *  leaves `starting` for any reason) - if it's still stuck in `starting` after
   *  `zombieDetectionTimeoutMinutes`, the process is killed as a zombie stuck in an endless
   *  loop, optionally followed by an automatic restart attempt. Independent per profile. */
  zombieDetectionEnabled: boolean
  /** Minutes to wait in `starting` before treating it as a zombie. Default 10. */
  zombieDetectionTimeoutMinutes: number
  /** Whether to attempt starting the server again right after killing a detected zombie. */
  zombieDetectionAutoRestart: boolean
  /** Max size (MB) of this server's permanent Cluster Console log archive
   *  (clusterLogArchive.ts) before its oldest events are trimmed to make room - a rolling
   *  window, not a hard cutoff that stops archiving. The archive only ever holds already-
   *  parsed, displayable events (one per line, as JSON) - not raw ShooterGame.log text - so
   *  the internal engine noise that makes up most of the raw file never counts against this
   *  limit in the first place. Unlike ShooterGame.log itself, the archive is never reset by
   *  a server restart, so the group console's backlog can span further back than the current
   *  session. Always on, no separate enable toggle - this is passive background logging, not
   *  an automated action like the watchdog/zombie features above. Default 10, configurable
   *  1-100 (enforced by the Server Management tab's input, not this type itself). */
  clusterLogArchiveMaxSizeMB: number
  /** When true, this server is started automatically when the Manager application itself
   *  launches (not to be confused with AppSettings.launchOnStartup, which is about the
   *  Manager launching at OS login). Staggered against other auto-start profiles by
   *  AppSettings.serverAutoStartStaggerSeconds. Skipped if the server is already running
   *  (re-adopted from a previous Manager session). */
  startOnManagerLaunch: boolean
  /** When true, hidden from the main dashboard grid (and bulk "...All" actions) without
   *  deleting it or touching whatever server process is actually running - just a way to
   *  declutter the main list for a profile you're not actively using right now. */
  hidden: boolean
  /** Free-form dashboard grouping label. Empty (the default) means "no group" - shown
   *  directly in the main grid. Any other value collects every profile sharing it into
   *  its own collapsible section on the dashboard, named after the group. */
  group: string
  /** When true, this server's CPU/RAM/player count are sampled continuously in the main
   *  process (src/main/lib/statsHistory.ts) and persisted to disk, independent of whether
   *  any Analytics tab or Cluster Dashboard is currently open to see them live. Shares one
   *  global size budget (AppSettings.statsHistoryMaxSizeMB) across every profile that has
   *  this on. Default off - a server's owner opts in per profile. */
  statsEnabled: boolean
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
  /** When true, the web dashboard requires a valid access token (see
   *  WebDashboardAccessToken) and switches to HTTPS with a self-signed certificate - meant
   *  for exposing it outside the LAN. When false (default), it behaves exactly as before:
   *  no auth, plain HTTP. */
  webDashboardAuthEnabled: boolean
  /** Delay, in seconds, between two servers auto-starting at Manager launch (see
   *  ServerProfile.startOnManagerLaunch). Only affects profiles that opt in - the first one
   *  starts immediately, each subsequent one waits this long after the previous one. */
  serverAutoStartStaggerSeconds: number
  /** When true (default), a server's GameUserSettings.ini/Game.ini are set read-only while
   *  it's running (see src/main/lib/iniLock.ts) - a deterrent against editing a running
   *  server's config by accident. Turning this off unlocks every profile's config files
   *  right away, including ones currently running. */
  iniLockEnabled: boolean
  /** Global cap (MB) on the combined size of every profile's persisted CPU/RAM/player
   *  history (src/main/lib/statsHistory.ts), shared across every profile with
   *  ServerProfile.statsEnabled on - not a per-server quota. Once exceeded, the oldest
   *  samples (from whichever profile they belong to) are trimmed first. Default 1024 (1GB). */
  statsHistoryMaxSizeMB: number
  /** Global age cap (hours) on the same persisted CPU/RAM/player history - a sample older
   *  than this is trimmed regardless of how far the size cap above still has to go. Keeps
   *  a long-running Manager's stats file (and the read/parse cost of ever touching it) from
   *  growing indefinitely just because nothing has hit the byte budget yet. Default 24. */
  statsHistoryMaxAgeHours: number
}

/** Four tiers, highest to lowest: `globalAdmin` (everything, every server, regardless of any
 *  `profileIds` scoping on the credential - the only role that ignores it), `admin` (the same
 *  full permission set as globalAdmin, but restricted to whichever servers the credential is
 *  scoped to via `profileIds`, exactly like every other role already is), `moderator` (start/
 *  stop/RCON/create-backup plus the Console/Analytics/Backup/Server Management/Cluster
 *  Dashboard views - everything but Settings/Mods/Map Management/Update Log), `readonly` (view
 *  only, no actions). Legacy stored values from before this 4-tier split - `'admin'` (which
 *  used to mean unrestricted) and `'operator'` - are migrated lazily on read; see
 *  migrateLegacyRole in store.ts. */
export type WebDashboardRole = 'globalAdmin' | 'admin' | 'moderator' | 'readonly'

/**
 * A browser access token for the web dashboard page itself - pasted once into the browser
 * (stored in that browser's own localStorage, never a cookie/session) and sent back as
 * `Authorization: Bearer ark_<id>_<secret>` on every request from then on, exactly like a
 * WebDashboardApiKey but kept in its own separate list: this is what a *person* pastes into
 * their browser, an API key is what a *script/bot* is configured with. Managed only from
 * the Manager's own Settings screen - the dashboard page itself never creates/edits/deletes
 * tokens, only presents one. Keeping token management desktop-only means granting/revoking
 * browser access always requires local access to the machine running the Manager, never
 * just a web session.
 */
export interface WebDashboardAccessToken {
  id: string
  /** Free-form label so more than one token stays identifiable (e.g. "My laptop"). */
  label: string
  /** Never sent to the renderer - see WebDashboardAccessTokenSummary for what it gets instead. */
  secretHash: string
  role: WebDashboardRole
  /** Which server profiles this token can see/act on - `null` means every profile (the
   *  default, and the only behavior before this field existed, so older stored tokens with
   *  no field at all keep working exactly as before). An empty array also means every
   *  profile, matching the Settings UI's "nothing checked = all servers" picker. Enforced
   *  server-side on every route that operates on a specific profile or group, not just
   *  filtered out of the dashboard's own UI. */
  profileIds: string[] | null
  createdAt: number
}

/** WebDashboardAccessToken with the secret hash stripped out, for the renderer/Settings UI. */
export type WebDashboardAccessTokenSummary = Omit<WebDashboardAccessToken, 'secretHash'>

/**
 * A programmatic credential for the web dashboard's HTTP API - meant for scripts/bots
 * that can't drive a login form/session cookie the way a browser does. Presented as
 * `Authorization: Bearer ark_<id>_<secret>`; `id` is looked up directly (not scanned) and
 * `secret` is checked against `secretHash` the same way an account's password is. Like
 * accounts, managed only from the Manager's own Settings screen - never exposed over the
 * dashboard's own HTTP API.
 */
export interface WebDashboardApiKey {
  id: string
  /** Free-form label so more than one key stays identifiable (e.g. "Discord bot"). */
  label: string
  /** Never sent to the renderer - see WebDashboardApiKeySummary for what it gets instead. */
  secretHash: string
  role: WebDashboardRole
  createdAt: number
}

/** WebDashboardApiKey with the secret hash stripped out, for the renderer/Settings UI. */
export type WebDashboardApiKeySummary = Omit<WebDashboardApiKey, 'secretHash'>

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
  /** Set whenever the last attempt to read CPU/RAM (pidusage) failed, with its raw error
   *  message - surfaced in the UI so a persistent failure (e.g. a missing OS tool) is
   *  diagnosable without needing the Manager's own console output. Cleared once a reading
   *  succeeds again. */
  statsError?: string
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
  /** Pushed to every renderer window whenever the stored profile list actually changes -
   *  regardless of what triggered it (this window's own IPC calls, or a write from the web
   *  dashboard's HTTP API, which never goes through IPC at all) - so an edit made from the
   *  web dashboard shows up live in the desktop app without needing a restart or manual
   *  refresh. */
  profilesChanged: 'profiles:changed',

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
  serverGetInstalledBuildId: 'server:get-installed-build-id',
  serverGetGameVersion: 'server:get-game-version',

  modsSave: 'mods:save',
  modsParseText: 'mods:parse-text',

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
  steamcmdUpdateLogChanged: 'steamcmd:update-log-changed',
  steamcmdAddFirewallRule: 'steamcmd:add-firewall-rule',
  steamcmdLatestBuildId: 'steamcmd:latest-build-id',

  mapsList: 'maps:list',
  customMapsList: 'custom-maps:list',
  dataDirGetDefault: 'data-dir:get-default',

  officialServerStatusGet: 'official-server-status:get',

  webDashboardStatus: 'web-dashboard:status',
  webDashboardLocalIps: 'web-dashboard:local-ips',

  webDashboardAccessTokensList: 'web-dashboard-access-tokens:list',
  webDashboardAccessTokensCreate: 'web-dashboard-access-tokens:create',
  webDashboardAccessTokensUpdate: 'web-dashboard-access-tokens:update',
  webDashboardAccessTokensDelete: 'web-dashboard-access-tokens:delete',

  webDashboardApiKeysList: 'web-dashboard-api-keys:list',
  webDashboardApiKeysCreate: 'web-dashboard-api-keys:create',
  webDashboardApiKeysUpdate: 'web-dashboard-api-keys:update',
  webDashboardApiKeysDelete: 'web-dashboard-api-keys:delete',

  appOpenProfilesFolder: 'app:open-profiles-folder',
  appOpenDataDirFolder: 'app:open-data-dir-folder',
  serverOpenConfigFolder: 'server:open-config-folder',
  serverOpenSavedArksFolder: 'server:open-savedarks-folder',
  serverOpenSaveGamesFolder: 'server:open-savegames-folder',

  mapManagementList: 'map-management:list',
  mapManagementCreate: 'map-management:create',
  mapManagementDelete: 'map-management:delete',
  mapManagementOpenFolder: 'map-management:open-folder',

  appUpdateGetVersion: 'app-update:get-version',
  appUpdateCheck: 'app-update:check',
  appUpdateInstall: 'app-update:install',
  appUpdateStatus: 'app-update:status',
  appUpdateStatusChanged: 'app-update:status-changed',

  groupConsoleSubscribe: 'group-console:subscribe',
  groupConsoleUnsubscribe: 'group-console:unsubscribe',
  groupConsoleEvent: 'group-console:event',
  groupConsoleRconSend: 'group-console:rcon-send',

  managerLogGet: 'manager-log:get',
  managerLogChanged: 'manager-log:changed',

  statsHistoryGet: 'stats-history:get',
  statsHistoryGetForGroup: 'stats-history:get-for-group',
  statsHistoryGetForGroups: 'stats-history:get-for-groups'
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
 * the renderers (the web dashboard page and the Cluster Data group console) that both need
 * to strip them back out while building the DOM. Never rendered as literal characters.
 */
export const PLAYER_NAME_OPEN = '\u0001'
export const PLAYER_NAME_CLOSE = '\u0002'

/** A LogEvent tagged with which server it came from - used by the Cluster Data group
 *  console, which merges the live feed of every server in a group into one chronological
 *  view. */
export interface GroupConsoleEvent extends LogEvent {
  /** The log line's date (ARK's own "YYYY.MM.DD" format). LogEvent.ts alone is HH:MM:SS -
   *  fine for ordering one server's own feed (it always arrives in order), but not enough
   *  to correctly merge multiple servers' backlogs, which can individually span more than
   *  a single day. */
  date: string
  profileId: string
  profileName: string
}

/**
 * One entry in the Manager's own activity log (src/main/lib/managerLog.ts) - what the
 * Manager itself did (Start/Stop/Kill/Restart, a scheduled restart, a backup), separate
 * from any one server's own ShooterGame.log or per-server SteamCMD update log. Every entry
 * belongs to a `taskId`: a single manual action (e.g. a plain Start) is a task with exactly
 * one entry, while a multi-step task (a scheduled restart's stop/update/start sequence, a
 * backup's save/zip sequence) reuses the same taskId across several entries so the Manager
 * Log view can group them under one `taskLabel` header instead of showing each step as an
 * unrelated line.
 */
export interface ManagerLogEntry {
  id: string
  /** The entry's date (ARK log style "YYYY.MM.DD") - same reasoning as GroupConsoleEvent's
   *  own `date` field: `ts` alone (HH:MM:SS) isn't enough to order entries spanning more
   *  than a day. */
  date: string
  ts: string
  taskId: string
  taskLabel: string
  message: string
  level: 'info' | 'error'
}

/**
 * One point of a server's (or a cluster group's summed) CPU/RAM/player history, as returned
 * by src/main/lib/statsHistory.ts. `time` is the point's own timestamp - for a query
 * spanning more history than the requested point budget, this is already downsampled
 * (bucketed and averaged/summed server-side), so the array is never larger than the
 * `maxPoints` the caller asked for regardless of how much raw history it's built from.
 */
export interface StatSample {
  time: number
  cpu: number
  memoryMB: number
  players: number
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
    copy: (profileId: string, destInstallDir: string, newName: string) => Promise<ImportResult>
    move: (profileId: string, destInstallDir: string, newName: string) => Promise<ImportResult>
    /** Fires with the full, current profile list whenever it changes for any reason,
     *  including a save made through the web dashboard's HTTP API rather than this window's
     *  own IPC calls. */
    onChanged: (callback: (profiles: ServerProfile[]) => void) => () => void
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
    getInstalledBuildId: (profileId: string) => Promise<string | null>
    /** The human-readable game version (e.g. "92.28"), read from the running server's own
     *  console window title - Windows-only, and null until the server is running and that
     *  title has actually been set (a few seconds into startup). */
    getGameVersion: (profileId: string) => Promise<string | null>
  }
  mods: {
    save: (profileId: string, mods: ServerMod[]) => Promise<ServerProfile>
    /** Parses/validates a pasted mod list (the same JSON shape `JSON.stringify(mods, null,
     *  2)` produces) - shares the exact validation `mods:import-from-file` used to have, just
     *  reached from pasted text instead of a file. Throws with a readable message on
     *  malformed input rather than silently dropping bad entries. */
    parseText: (text: string) => Promise<ServerMod[]>
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
    onUpdateLogChanged: (callback: (profileId: string) => void) => () => void
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
  webDashboardAccessTokens: {
    list: () => Promise<WebDashboardAccessTokenSummary[]>
    create: (
      label: string,
      role: WebDashboardRole,
      profileIds: string[] | null
    ) => Promise<{ token: string; tokens: WebDashboardAccessTokenSummary[] }>
    /** Changes an existing token's role/label/server scope in place - the token's own
     *  secret (and so the value already pasted into a browser) is untouched, so this never
     *  logs anyone out the way delete-and-recreate would. */
    update: (
      id: string,
      updates: { label?: string; role?: WebDashboardRole; profileIds?: string[] | null }
    ) => Promise<WebDashboardAccessTokenSummary[]>
    delete: (id: string) => Promise<WebDashboardAccessTokenSummary[]>
  }
  webDashboardApiKeys: {
    list: () => Promise<WebDashboardApiKeySummary[]>
    /** Resolves with the full plaintext key, shown to the user exactly once - only its
     *  hash is ever stored, so it can't be retrieved again after this. */
    create: (label: string, role: WebDashboardRole) => Promise<{ key: string; keys: WebDashboardApiKeySummary[] }>
    /** Same idea as webDashboardAccessTokens.update - changes role/label without touching
     *  the key's own secret. */
    update: (id: string, updates: { label?: string; role?: WebDashboardRole }) => Promise<WebDashboardApiKeySummary[]>
    delete: (id: string) => Promise<WebDashboardApiKeySummary[]>
  }
  system: {
    openProfilesFolder: () => Promise<void>
    openDataDirFolder: () => Promise<void>
    openServerConfigFolder: (profileId: string) => Promise<void>
    openServerSavedArksFolder: (profileId: string) => Promise<void>
    openServerSaveGamesFolder: (profileId: string) => Promise<void>
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
  groupConsole: {
    /** Starts tailing every given profile's log and resolves with its current backlog
     *  (merged across all of them, sorted by timestamp) - replaces whatever subscription
     *  was previously active, if any. */
    subscribe: (profileIds: string[]) => Promise<GroupConsoleEvent[]>
    /** Stops the active subscription's tailers. Safe to call with nothing subscribed. */
    unsubscribe: () => Promise<void>
    onEvent: (callback: (event: GroupConsoleEvent) => void) => () => void
    /** Sends an RCON command to one server in the group - never rejects, the result's
     *  `ok`/`error` says whether it actually succeeded. */
    sendRcon: (profileId: string, command: string) => Promise<RconResult>
  }
  managerLog: {
    getLog: () => Promise<ManagerLogEntry[]>
    onLogChanged: (callback: (entry: ManagerLogEntry) => void) => () => void
  }
  statsHistory: {
    /** `sinceMs: null` means "since the earliest recorded sample" (the "All" time scale). */
    get: (profileId: string, sinceMs: number | null, maxPoints?: number) => Promise<StatSample[]>
    getForGroup: (profileIds: string[], sinceMs: number | null, maxPoints?: number) => Promise<StatSample[]>
    /** Same as getForGroup, but for every dashboard group in one call - reads and parses
     *  the shared stats-history file once for all of them instead of once per group. Keyed
     *  by the same group name (trimmed ServerProfile.group, '' for ungrouped) passed in. */
    getForGroups: (
      groupProfileIds: Record<string, string[]>,
      sinceMs: number | null,
      maxPoints?: number
    ) => Promise<Record<string, StatSample[]>>
  }
}
