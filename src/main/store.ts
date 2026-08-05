import Store from 'electron-store'
import type { ServerProfile, AppSettings, WebDashboardAccount } from '@shared/types'
import { migrateProfile } from './lib/profileMigration'
import { reorderProfiles } from './lib/reorder'
import { stripWrappingQuotes } from './lib/pathSanitize'

interface StoreSchema {
  profiles: ServerProfile[]
  settings: AppSettings
  /** profileId -> OS pid, so a re-launched app can find a server that's still running. */
  runningPids: Record<string, number>
  /** profileId -> when that server was actually started (Date.now() at spawn time), so
   *  a re-launched app can still compute an accurate uptime for a server it re-adopts
   *  instead of one that resets to "just started". */
  runningStartedAt: Record<string, number>
  /** Web dashboard login accounts - only touched from the Manager's own Settings screen. */
  webDashboardAccounts: WebDashboardAccount[]
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
      serverAutoStartStaggerSeconds: 10
    },
    runningPids: {},
    runningStartedAt: {},
    webDashboardAccounts: []
  }
})

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
  return profiles
}

export function setProfileOrder(orderedIds: string[]): ServerProfile[] {
  const profiles = reorderProfiles(listProfiles(), orderedIds)
  store.set('profiles', profiles)
  return profiles
}

export function deleteProfile(id: string): ServerProfile[] {
  const profiles = listProfiles().filter((p) => p.id !== id)
  store.set('profiles', profiles)
  setRunningPid(id, null)
  setRunningStartedAt(id, null)
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
    ...settings
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  store.set('settings', settings)
  return settings
}

export function listWebDashboardAccounts(): WebDashboardAccount[] {
  return store.get('webDashboardAccounts') ?? []
}

export function saveWebDashboardAccount(account: WebDashboardAccount): WebDashboardAccount[] {
  const accounts = listWebDashboardAccounts()
  const idx = accounts.findIndex((a) => a.id === account.id)
  if (idx >= 0) accounts[idx] = account
  else accounts.push(account)
  store.set('webDashboardAccounts', accounts)
  return accounts
}

export function deleteWebDashboardAccount(id: string): WebDashboardAccount[] {
  const accounts = listWebDashboardAccounts().filter((a) => a.id !== id)
  store.set('webDashboardAccounts', accounts)
  return accounts
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
