import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import type {
  ServerProfile,
  AppSettings,
  WebDashboardAccessToken,
  WebDashboardApiKey,
  BannedPlayer,
  WhitelistedPlayer,
  WatchedPlayerAlert,
  PlayerActivityRecord,
  PlayerActivitySession,
  ConfigFileHistoryEntry
} from '@shared/types'
import type { MinecraftProfile } from '@shared/minecraft'
import { migrateProfile } from './lib/profileMigration'
import { migrateMinecraftProfile } from './lib/minecraftProfileMigration'
import { reorderProfiles } from './lib/reorder'
import { stripWrappingQuotes } from './lib/pathSanitize'
import { migrateLegacyRole } from './lib/auth'

/** Emits 'changed' with the full, current profile list after every save/delete/reorder,
 *  regardless of caller - the desktop app's own IPC handlers and the web dashboard's HTTP
 *  routes both end up calling saveProfile/deleteProfile/setProfileOrder below, so this is
 *  the one place that can notify every open renderer window without either caller needing
 *  to remember to do it itself. See src/main/ipc/profiles.ts for where this gets forwarded
 *  to the renderer as IPC.profilesChanged. */
export const profileEvents = new EventEmitter()

/** Same idea as profileEvents, for Minecraft profiles - see ipc/minecraft.ts. */
export const minecraftProfileEvents = new EventEmitter()

interface StoreSchema {
  profiles: ServerProfile[]
  minecraftProfiles: MinecraftProfile[]
  settings: AppSettings
  /** profileId -> OS pid, so a re-launched app can find a server that's still running. */
  runningPids: Record<string, number>
  /** profileId -> when that server was actually started (Date.now() at spawn time), so
   *  a re-launched app can still compute an accurate uptime for a server it re-adopts
   *  instead of one that resets to "just started". */
  runningStartedAt: Record<string, number>
  /** Same idea as runningPids/runningStartedAt above, for Minecraft profiles - see
   *  minecraftProcess.ts's adoptPersistedMinecraftProcesses. Kept as its own pair of keys
   *  (not merged into the ARK ones) since profile ids aren't namespaced by game and could
   *  theoretically collide between an ARK profile and a Minecraft one. */
  minecraftRunningPids: Record<string, number>
  minecraftRunningStartedAt: Record<string, number>
  /** Web dashboard browser access tokens - only touched from the Manager's own Settings
   *  screen. */
  webDashboardAccessTokens: WebDashboardAccessToken[]
  /** Web dashboard API keys - only touched from the Manager's own Settings screen. */
  webDashboardApiKeys: WebDashboardApiKey[]
  /** Centralized ban list - see BannedPlayer's own doc comment (shared/types.ts). */
  playerBans: BannedPlayer[]
  /** Centralized whitelist (tracking-only) - see WhitelistedPlayer's own doc comment. */
  playerWhitelist: WhitelistedPlayer[]
  /** Discord "player joined" alert watchlist - see WatchedPlayerAlert's own doc comment. */
  watchedPlayers: WatchedPlayerAlert[]
  /** Aggregated per-player playtime, keyed by Steam/EOS id - see PlayerActivityRecord. */
  playerActivity: Record<string, PlayerActivityRecord>
  /** Capped recent-session log - see PlayerActivitySession and recordPlayerSession. */
  playerSessions: PlayerActivitySession[]
  /** Config file edit history - see ConfigFileHistoryEntry and recordConfigFileHistory. */
  configFileHistory: ConfigFileHistoryEntry[]
  /** Set once the pre-4-tier-role migration (legacy 'admin' -> globalAdmin, 'operator' ->
   *  moderator) has actually been written back to the two lists above. Must run at most
   *  once, ever: 'admin' is now also the current, intentional value for the new scoped
   *  Admin tier, so re-running this migration on every read (as an earlier version of this
   *  code did) would keep silently promoting every freshly-created Admin token to Global
   *  Admin forever, which is exactly backwards. */
  webDashboardRolesMigrated: boolean
  /** Set once migrateProfile()'s backfills (game, and every other field added since a given
   *  profile was first saved) have actually been written back to disk, rather than only
   *  ever applied in-memory on read (the general pattern `listProfiles()` still also does
   *  on every call, unconditionally - this flag just controls the one-time persisted write,
   *  purely so config.json reflects reality without waiting on a profile happening to be
   *  edited). Unlike the role flag above, re-running this would be harmless (migrateProfile
   *  is idempotent), but there's no reason to pay for a write on every single read either. */
  profilesMigratedToDisk: boolean
}

const store = new Store<StoreSchema>({
  defaults: {
    profiles: [],
    minecraftProfiles: [],
    settings: {
      steamCmdPath: '',
      dataDir: '',
      webDashboardEnabled: false,
      webDashboardPort: 8090,
      webDashboardHost: '127.0.0.1',
      webDashboardDisabledLabels: [],
      launchOnStartup: false,
      closeToTrayEnabled: false,
      webDashboardAuthEnabled: false,
      serverAutoStartStaggerSeconds: 10,
      iniLockEnabled: true,
      statsHistoryMaxSizeMB: 1024,
      statsHistoryMaxAgeHours: 24,
      showServerConsoleWindow: true,
      groupOrder: [],
      collapsedGroups: [],
      minecraftGroupOrder: [],
      minecraftCollapsedGroups: [],
      curseforgeApiKey: '',
      discordBotEnabled: false,
      discordBotToken: '',
      discordBotDevGuildId: '',
      discordBotStatusChannelId: '',
      discordBotRefreshSeconds: 60,
      discordBotStatusEmbedTitle: '🦖 Statut ARK: Survival Ascended',
      discordBotStatusEmbedDescription: '',
      discordBotStatusEmbedColor: '9B59B6',
      discordBotArkCheckEnabled: true,
      discordBotMcStatusChannelId: '',
      discordBotMcRefreshSeconds: 60,
      discordBotMcStatusEmbedTitle: '⛏️ Statut Minecraft',
      discordBotMcStatusEmbedDescription: '',
      discordBotMcStatusEmbedColor: '9B59B6',
      discordBotMcCheckEnabled: true,
      discordBotMaintenanceWhitelistIds: [],
      discordBotManagerWhitelistIds: [],
      discordBotCurseforgeModuleEnabled: true,
      discordBotCurseforgeDefaultModIds: [],
      discordBotCurseforgeCheckIntervalMinutes: 10,
      discordBotPlayerAlertEnabled: false,
      discordBotPlayerAlertChannelId: '',
      playerActivityTrackingEnabled: false,
      discordBotApiKeyId: ''
    },
    runningPids: {},
    runningStartedAt: {},
    minecraftRunningPids: {},
    minecraftRunningStartedAt: {},
    webDashboardAccessTokens: [],
    webDashboardApiKeys: [],
    playerBans: [],
    playerWhitelist: [],
    watchedPlayers: [],
    playerActivity: {},
    playerSessions: [],
    configFileHistory: [],
    webDashboardRolesMigrated: false,
    profilesMigratedToDisk: false
  }
})

/** Runs the legacy-role migration exactly once, persisting the result immediately so it
 *  never runs again - see the webDashboardRolesMigrated doc comment above for why running
 *  it more than once would be actively harmful. Safe to call from both list functions
 *  below; the stored flag makes every call after the first a no-op. */
function migrateStoredRolesOnce(): void {
  if (store.get('webDashboardRolesMigrated')) return
  const tokens = (store.get('webDashboardAccessTokens') ?? []).map((t) => ({ ...t, role: migrateLegacyRole(t.role) }))
  const keys = (store.get('webDashboardApiKeys') ?? []).map((k) => ({ ...k, role: migrateLegacyRole(k.role) }))
  store.set('webDashboardAccessTokens', tokens)
  store.set('webDashboardApiKeys', keys)
  store.set('webDashboardRolesMigrated', true)
}

/** Persists migrateProfile()'s backfilled fields (game, etc.) back to disk exactly once,
 *  so config.json stops lagging behind what the app actually uses in memory - see the
 *  profilesMigratedToDisk doc comment above. */
function migrateProfilesToDiskOnce(): void {
  if (store.get('profilesMigratedToDisk')) return
  store.set('profiles', store.get('profiles').map(migrateProfile))
  store.set('profilesMigratedToDisk', true)
}

export function listProfiles(): ServerProfile[] {
  migrateProfilesToDiskOnce()
  return store.get('profiles').map(migrateProfile)
}

export function getProfile(id: string): ServerProfile | undefined {
  return listProfiles().find((p) => p.id === id)
}

export function saveProfile(profile: ServerProfile): ServerProfile[] {
  const sanitized: ServerProfile = {
    ...profile,
    installDir: stripWrappingQuotes(profile.installDir),
    backupDir: stripWrappingQuotes(profile.backupDir),
    clusterDirOverride: stripWrappingQuotes(profile.clusterDirOverride)
  }
  const profiles = listProfiles()
  const idx = profiles.findIndex((p) => p.id === sanitized.id)
  if (idx >= 0) profiles[idx] = sanitized
  else profiles.push(sanitized)
  store.set('profiles', profiles)
  profileEvents.emit('changed', profiles)
  return profiles
}

export function setProfileOrder(orderedIds: string[]): ServerProfile[] {
  const profiles = reorderProfiles(listProfiles(), orderedIds)
  store.set('profiles', profiles)
  profileEvents.emit('changed', profiles)
  return profiles
}

export function deleteProfile(id: string): ServerProfile[] {
  const profiles = listProfiles().filter((p) => p.id !== id)
  store.set('profiles', profiles)
  setRunningPid(id, null)
  setRunningStartedAt(id, null)
  profileEvents.emit('changed', profiles)
  return profiles
}

export function listMinecraftProfiles(): MinecraftProfile[] {
  return (store.get('minecraftProfiles') ?? []).map(migrateMinecraftProfile)
}

export function getMinecraftProfile(id: string): MinecraftProfile | undefined {
  return listMinecraftProfiles().find((p) => p.id === id)
}

export function saveMinecraftProfile(profile: MinecraftProfile): MinecraftProfile[] {
  const sanitized: MinecraftProfile = { ...profile, installDir: stripWrappingQuotes(profile.installDir) }
  const profiles = listMinecraftProfiles()
  const idx = profiles.findIndex((p) => p.id === sanitized.id)
  if (idx >= 0) profiles[idx] = sanitized
  else profiles.push(sanitized)
  store.set('minecraftProfiles', profiles)
  minecraftProfileEvents.emit('changed', profiles)
  return profiles
}

export function deleteMinecraftProfile(id: string): MinecraftProfile[] {
  const profiles = listMinecraftProfiles().filter((p) => p.id !== id)
  store.set('minecraftProfiles', profiles)
  setMinecraftRunningPid(id, null)
  setMinecraftRunningStartedAt(id, null)
  minecraftProfileEvents.emit('changed', profiles)
  return profiles
}

export function getSettings(): AppSettings {
  // Cast to Partial: settings saved before dataDir existed won't actually have it at
  // runtime, even though the stored type says otherwise.
  const settings = store.get('settings') as Partial<AppSettings> | undefined
  return {
    steamCmdPath: '',
    dataDir: '',
    webDashboardEnabled: false,
    webDashboardPort: 8090,
    webDashboardHost: '127.0.0.1',
    webDashboardDisabledLabels: [],
    launchOnStartup: false,
    closeToTrayEnabled: false,
    webDashboardAuthEnabled: false,
    serverAutoStartStaggerSeconds: 10,
    iniLockEnabled: true,
    statsHistoryMaxSizeMB: 1024,
    statsHistoryMaxAgeHours: 24,
    showServerConsoleWindow: true,
    groupOrder: [],
    collapsedGroups: [],
    minecraftGroupOrder: [],
    minecraftCollapsedGroups: [],
    curseforgeApiKey: '',
    discordBotEnabled: false,
    discordBotToken: '',
    discordBotDevGuildId: '',
    discordBotStatusChannelId: '',
    discordBotRefreshSeconds: 60,
    discordBotStatusEmbedTitle: '🦖 Statut ARK: Survival Ascended',
    discordBotStatusEmbedDescription: '',
    discordBotStatusEmbedColor: '9B59B6',
    discordBotArkCheckEnabled: true,
    discordBotMcStatusChannelId: '',
    discordBotMcRefreshSeconds: 60,
    discordBotMcStatusEmbedTitle: '⛏️ Statut Minecraft',
    discordBotMcStatusEmbedDescription: '',
    discordBotMcStatusEmbedColor: '9B59B6',
    discordBotMcCheckEnabled: true,
    discordBotMaintenanceWhitelistIds: [],
    discordBotManagerWhitelistIds: [],
    discordBotCurseforgeModuleEnabled: true,
    discordBotCurseforgeDefaultModIds: [],
    discordBotCurseforgeCheckIntervalMinutes: 10,
    discordBotPlayerAlertEnabled: false,
    discordBotPlayerAlertChannelId: '',
    playerActivityTrackingEnabled: false,
    discordBotApiKeyId: '',
    ...settings
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  store.set('settings', settings)
  return settings
}

export function listWebDashboardAccessTokens(): WebDashboardAccessToken[] {
  migrateStoredRolesOnce()
  return store.get('webDashboardAccessTokens') ?? []
}

export function saveWebDashboardAccessToken(token: WebDashboardAccessToken): WebDashboardAccessToken[] {
  const tokens = listWebDashboardAccessTokens()
  const idx = tokens.findIndex((t) => t.id === token.id)
  if (idx >= 0) tokens[idx] = token
  else tokens.push(token)
  store.set('webDashboardAccessTokens', tokens)
  return tokens
}

export function deleteWebDashboardAccessToken(id: string): WebDashboardAccessToken[] {
  const tokens = listWebDashboardAccessTokens().filter((t) => t.id !== id)
  store.set('webDashboardAccessTokens', tokens)
  return tokens
}

export function listWebDashboardApiKeys(): WebDashboardApiKey[] {
  migrateStoredRolesOnce()
  return store.get('webDashboardApiKeys') ?? []
}

export function saveWebDashboardApiKey(key: WebDashboardApiKey): WebDashboardApiKey[] {
  const keys = listWebDashboardApiKeys()
  const idx = keys.findIndex((k) => k.id === key.id)
  if (idx >= 0) keys[idx] = key
  else keys.push(key)
  store.set('webDashboardApiKeys', keys)
  return keys
}

export function deleteWebDashboardApiKey(id: string): WebDashboardApiKey[] {
  const keys = listWebDashboardApiKeys().filter((k) => k.id !== id)
  store.set('webDashboardApiKeys', keys)
  return keys
}

export function listPlayerBans(): BannedPlayer[] {
  return store.get('playerBans') ?? []
}

/** Records that `playerId` has now been banned on `profileId` too - upserts an existing
 *  entry (adding the profile id if not already present, refreshing name/reason/bannedAt)
 *  rather than creating a duplicate per server, since the whole point is one merged view
 *  across every server a given id has actually been banned on. */
export function recordPlayerBan(playerId: string, playerName: string, reason: string, profileId: string): BannedPlayer[] {
  const bans = listPlayerBans()
  const existing = bans.find((b) => b.id === playerId)
  if (existing) {
    existing.name = playerName
    existing.reason = reason
    existing.bannedAt = Date.now()
    if (!existing.profileIds.includes(profileId)) existing.profileIds.push(profileId)
  } else {
    bans.push({ id: playerId, name: playerName, reason, bannedAt: Date.now(), profileIds: [profileId] })
  }
  store.set('playerBans', bans)
  return bans
}

/** Removes `profileId` from `playerId`'s entry - and the entry entirely once no profile is
 *  left on it, rather than leaving a dangling ban that no longer applies anywhere. */
export function removePlayerBanProfile(playerId: string, profileId: string): BannedPlayer[] {
  const bans = listPlayerBans()
    .map((b) => (b.id === playerId ? { ...b, profileIds: b.profileIds.filter((id) => id !== profileId) } : b))
    .filter((b) => b.profileIds.length > 0)
  store.set('playerBans', bans)
  return bans
}

export function listWhitelistedPlayers(): WhitelistedPlayer[] {
  return store.get('playerWhitelist') ?? []
}

/** Same upsert-across-servers shape as recordPlayerBan, just with no RCON side effect behind
 *  it - this list is tracking-only (see WhitelistedPlayer's own doc comment). */
export function recordWhitelistedPlayer(playerId: string, playerName: string, profileId: string): WhitelistedPlayer[] {
  const entries = listWhitelistedPlayers()
  const existing = entries.find((e) => e.id === playerId)
  if (existing) {
    existing.name = playerName
    existing.addedAt = Date.now()
    if (!existing.profileIds.includes(profileId)) existing.profileIds.push(profileId)
  } else {
    entries.push({ id: playerId, name: playerName, addedAt: Date.now(), profileIds: [profileId] })
  }
  store.set('playerWhitelist', entries)
  return entries
}

/** Same drop-when-empty shape as removePlayerBanProfile. */
export function removeWhitelistedPlayerProfile(playerId: string, profileId: string): WhitelistedPlayer[] {
  const entries = listWhitelistedPlayers()
    .map((e) => (e.id === playerId ? { ...e, profileIds: e.profileIds.filter((id) => id !== profileId) } : e))
    .filter((e) => e.profileIds.length > 0)
  store.set('playerWhitelist', entries)
  return entries
}

export function listWatchedPlayers(): WatchedPlayerAlert[] {
  return store.get('watchedPlayers') ?? []
}

export function addWatchedPlayer(entry: WatchedPlayerAlert): WatchedPlayerAlert[] {
  const list = [...listWatchedPlayers(), entry]
  store.set('watchedPlayers', list)
  return list
}

export function removeWatchedPlayer(id: string): WatchedPlayerAlert[] {
  const list = listWatchedPlayers().filter((p) => p.id !== id)
  store.set('watchedPlayers', list)
  return list
}

const MAX_PLAYER_SESSIONS = 300

export function listPlayerActivity(): PlayerActivityRecord[] {
  return Object.values(store.get('playerActivity') ?? {})
}

export function listPlayerSessions(limit = 50): PlayerActivitySession[] {
  const sessions = store.get('playerSessions') ?? []
  return sessions.slice(-limit).reverse()
}

/** Closes one join-to-leave session: folds its duration into the player's aggregated
 *  PlayerActivityRecord (creating one on their first-ever session) and appends it to the
 *  capped recent-session log, trimming from the front once it grows past the cap - the
 *  aggregated totals are unaffected by that trim, only the recent-activity log is bounded. */
export function recordPlayerSession(profileId: string, playerId: string, playerName: string, joinedAt: number, leftAt: number): void {
  const durationMs = Math.max(0, leftAt - joinedAt)
  const activity = store.get('playerActivity') ?? {}
  const existing = activity[playerId]
  if (existing) {
    existing.name = playerName
    existing.totalPlaytimeMs += durationMs
    existing.sessionCount += 1
    existing.lastSeenAt = leftAt
    if (!existing.profileIds.includes(profileId)) existing.profileIds.push(profileId)
  } else {
    activity[playerId] = {
      id: playerId,
      name: playerName,
      totalPlaytimeMs: durationMs,
      sessionCount: 1,
      lastSeenAt: leftAt,
      profileIds: [profileId]
    }
  }
  store.set('playerActivity', activity)

  const sessions = [...(store.get('playerSessions') ?? []), { id: randomUUID(), profileId, playerId, playerName, joinedAt, leftAt }]
  store.set('playerSessions', sessions.length > MAX_PLAYER_SESSIONS ? sessions.slice(sessions.length - MAX_PLAYER_SESSIONS) : sessions)
}

/** Per-(profileId, path) cap, not a global one like MAX_PLAYER_SESSIONS - a server with
 *  several frequently-edited config files shouldn't have one of them crowd the others out
 *  of history entirely. */
const MAX_CONFIG_FILE_HISTORY_PER_FILE = 20

export function listConfigFileHistory(profileId: string, path: string): ConfigFileHistoryEntry[] {
  return (store.get('configFileHistory') ?? [])
    .filter((e) => e.profileId === profileId && e.path === path)
    .sort((a, b) => b.savedAt - a.savedAt)
}

export function getConfigFileHistoryEntry(id: string): ConfigFileHistoryEntry | undefined {
  return (store.get('configFileHistory') ?? []).find((e) => e.id === id)
}

/** Snapshots `content` (the file's content right before it's about to be overwritten - see
 *  the caller in webDashboard.ts) as a new history entry, trimming that same file's own
 *  oldest entries once there are more than MAX_CONFIG_FILE_HISTORY_PER_FILE of them. Other
 *  files' history (any other profileId/path pair) is never touched by this trim. */
export function recordConfigFileHistory(profileId: string, path: string, content: string): void {
  const all = store.get('configFileHistory') ?? []
  const forThisFile = all.filter((e) => e.profileId === profileId && e.path === path)
  const others = all.filter((e) => !(e.profileId === profileId && e.path === path))
  const updated = [...forThisFile, { id: randomUUID(), profileId, path, content, savedAt: Date.now() }]
  const trimmed = updated.length > MAX_CONFIG_FILE_HISTORY_PER_FILE ? updated.slice(updated.length - MAX_CONFIG_FILE_HISTORY_PER_FILE) : updated
  store.set('configFileHistory', [...others, ...trimmed])
}

export function getRunningPids(): Record<string, number> {
  return store.get('runningPids') ?? {}
}

// setRunningPid/setRunningStartedAt are best-effort persistence, purely so a running server
// can be re-adopted after a Manager restart (see serverProcess.ts's
// adoptPersistedProcesses) - losing that on a disk hiccup means one server doesn't
// re-adopt cleanly next launch, a minor problem. Every real call site, though, calls one of
// these immediately before emitStatus(), the one call that actually updates the renderer's
// own view of a server's state - a real report on Windows showed a disk-level write failure
// (a raw libuv "UNKNOWN: unknown error, write") throwing out of electron-store's own set()
// here, which skipped the emitStatus() call right after it entirely, leaving a server stuck
// showing as running in the UI long after it had actually stopped (or, symmetrically, never
// showing as started). Wrapped here, once, rather than at every call site, so nothing that
// calls these two functions needs to know or care that persisting this is allowed to fail.
function setPersistedRunningState(setter: () => void): void {
  try {
    setter()
  } catch (err) {
    console.error('Failed to persist running-process bookkeeping (non-fatal):', (err as Error).message)
  }
}

export function setRunningPid(profileId: string, pid: number | null): void {
  setPersistedRunningState(() => {
    const pids = getRunningPids()
    if (pid === null) {
      delete pids[profileId]
    } else {
      pids[profileId] = pid
    }
    store.set('runningPids', pids)
  })
}

export function getRunningStartedAt(): Record<string, number> {
  return store.get('runningStartedAt') ?? {}
}

export function setRunningStartedAt(profileId: string, startedAt: number | null): void {
  setPersistedRunningState(() => {
    const startedAtByProfile = getRunningStartedAt()
    if (startedAt === null) {
      delete startedAtByProfile[profileId]
    } else {
      startedAtByProfile[profileId] = startedAt
    }
    store.set('runningStartedAt', startedAtByProfile)
  })
}

export function getMinecraftRunningPids(): Record<string, number> {
  return store.get('minecraftRunningPids') ?? {}
}

export function setMinecraftRunningPid(profileId: string, pid: number | null): void {
  setPersistedRunningState(() => {
    const pids = getMinecraftRunningPids()
    if (pid === null) {
      delete pids[profileId]
    } else {
      pids[profileId] = pid
    }
    store.set('minecraftRunningPids', pids)
  })
}

export function getMinecraftRunningStartedAt(): Record<string, number> {
  return store.get('minecraftRunningStartedAt') ?? {}
}

export function setMinecraftRunningStartedAt(profileId: string, startedAt: number | null): void {
  setPersistedRunningState(() => {
    const startedAtByProfile = getMinecraftRunningStartedAt()
    if (startedAt === null) {
      delete startedAtByProfile[profileId]
    } else {
      startedAtByProfile[profileId] = startedAt
    }
    store.set('minecraftRunningStartedAt', startedAtByProfile)
  })
}
