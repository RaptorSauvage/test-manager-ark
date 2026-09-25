import { EventEmitter } from 'node:events'
import Store from 'electron-store'
import type { ServerProfile, AppSettings, WebDashboardAccessToken, WebDashboardApiKey } from '@shared/types'
import { migrateProfile } from './lib/profileMigration'
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

interface StoreSchema {
  profiles: ServerProfile[]
  settings: AppSettings
  /** profileId -> OS pid, so a re-launched app can find a server that's still running. */
  runningPids: Record<string, number>
  /** profileId -> when that server was actually started (Date.now() at spawn time), so
   *  a re-launched app can still compute an accurate uptime for a server it re-adopts
   *  instead of one that resets to "just started". */
  runningStartedAt: Record<string, number>
  /** Web dashboard browser access tokens - only touched from the Manager's own Settings
   *  screen. */
  webDashboardAccessTokens: WebDashboardAccessToken[]
  /** Web dashboard API keys - only touched from the Manager's own Settings screen. */
  webDashboardApiKeys: WebDashboardApiKey[]
  /** Set once the pre-4-tier-role migration (legacy 'admin' -> globalAdmin, 'operator' ->
   *  moderator) has actually been written back to the two lists above. Must run at most
   *  once, ever: 'admin' is now also the current, intentional value for the new scoped
   *  Admin tier, so re-running this migration on every read (as an earlier version of this
   *  code did) would keep silently promoting every freshly-created Admin token to Global
   *  Admin forever, which is exactly backwards. */
  webDashboardRolesMigrated: boolean
}

const store = new Store<StoreSchema>({
  defaults: {
    profiles: [],
    settings: {
      steamCmdPath: '',
      dataDir: '',
      webDashboardEnabled: false,
      webDashboardPort: 8090,
      webDashboardHost: '127.0.0.1',
      webDashboardDisabledLabels: [],
      launchOnStartup: false,
      webDashboardAuthEnabled: false,
      serverAutoStartStaggerSeconds: 10,
      iniLockEnabled: true,
      statsHistoryMaxSizeMB: 1024,
      statsHistoryMaxAgeHours: 24
    },
    runningPids: {},
    runningStartedAt: {},
    webDashboardAccessTokens: [],
    webDashboardApiKeys: [],
    webDashboardRolesMigrated: false
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

export function listProfiles(): ServerProfile[] {
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
    webDashboardAuthEnabled: false,
    serverAutoStartStaggerSeconds: 10,
    iniLockEnabled: true,
    statsHistoryMaxSizeMB: 1024,
    statsHistoryMaxAgeHours: 24,
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

export function getRunningPids(): Record<string, number> {
  return store.get('runningPids') ?? {}
}

export function setRunningPid(profileId: string, pid: number | null): void {
  const pids = getRunningPids()
  if (pid === null) {
    delete pids[profileId]
  } else {
    pids[profileId] = pid
  }
  store.set('runningPids', pids)
}

export function getRunningStartedAt(): Record<string, number> {
  return store.get('runningStartedAt') ?? {}
}

export function setRunningStartedAt(profileId: string, startedAt: number | null): void {
  const startedAtByProfile = getRunningStartedAt()
  if (startedAt === null) {
    delete startedAtByProfile[profileId]
  } else {
    startedAtByProfile[profileId] = startedAt
  }
  store.set('runningStartedAt', startedAtByProfile)
}
