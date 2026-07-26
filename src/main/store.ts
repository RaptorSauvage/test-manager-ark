import Store from 'electron-store'
import type { ServerProfile, AppSettings } from '@shared/types'
import { migrateProfile } from './lib/profileMigration'

interface StoreSchema {
  profiles: ServerProfile[]
  settings: AppSettings
}

const store = new Store<StoreSchema>({
  defaults: {
    profiles: [],
    settings: { steamCmdPath: '' }
  }
})

export function listProfiles(): ServerProfile[] {
  return store.get('profiles').map(migrateProfile)
}

export function getProfile(id: string): ServerProfile | undefined {
  return listProfiles().find((p) => p.id === id)
}

export function saveProfile(profile: ServerProfile): ServerProfile[] {
  const profiles = listProfiles()
  const idx = profiles.findIndex((p) => p.id === profile.id)
  if (idx >= 0) profiles[idx] = profile
  else profiles.push(profile)
  store.set('profiles', profiles)
  return profiles
}

export function deleteProfile(id: string): ServerProfile[] {
  const profiles = listProfiles().filter((p) => p.id !== id)
  store.set('profiles', profiles)
  return profiles
}

export function getSettings(): AppSettings {
  return store.get('settings') ?? { steamCmdPath: '' }
}

export function saveSettings(settings: AppSettings): AppSettings {
  store.set('settings', settings)
  return settings
}
