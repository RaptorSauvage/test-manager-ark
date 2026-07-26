import Store from 'electron-store'
import type { ServerProfile } from '@shared/types'

interface StoreSchema {
  profiles: ServerProfile[]
}

const store = new Store<StoreSchema>({
  defaults: {
    profiles: []
  }
})

/** Profiles saved before the mods field became `ServerMod[]` still have `activeMods: string[]`. */
function migrateProfile(raw: ServerProfile & { activeMods?: string[] }): ServerProfile {
  if (Array.isArray(raw.mods)) return raw
  const { activeMods, ...rest } = raw
  return { ...rest, mods: (activeMods ?? []).map((id) => ({ id, enabled: true })) }
}

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
