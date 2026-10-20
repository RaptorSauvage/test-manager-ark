import { randomUUID } from 'node:crypto'
import type { AppSettings, ClusterBundle, ServerProfile } from '@shared/types'
import type { MinecraftProfile } from '@shared/minecraft'
import { listProfiles, listMinecraftProfiles, getSettings } from '../store'
import { migrateProfile } from './profileMigration'
import { migrateMinecraftProfile } from './minecraftProfileMigration'
import { uniqueProfileName } from './detect'

/** Pretty-printed JSON of every ARK/Minecraft profile plus the Manager's own settings -
 *  suitable for writing straight to a file. See ClusterBundle's own doc comment (shared/
 *  types.ts) for exactly what this does and doesn't carry over. */
export function serializeClusterBundle(): string {
  const bundle: ClusterBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: listProfiles(),
    minecraftProfiles: listMinecraftProfiles(),
    settings: getSettings()
  }
  return JSON.stringify(bundle, null, 2)
}

/** Validates and migrates a previously exported bundle - the two profile lists get the
 *  same per-profile migration/fresh-id/unique-name treatment as a single-profile import
 *  (see profileExport.ts's parseImportedProfile), so importing twice - or into a cluster
 *  that already has some of these - never collides or silently overwrites an existing
 *  profile. The settings object is returned as-is (not merged/validated field by field);
 *  the caller decides whether to actually apply it. */
export function parseClusterBundle(fileContent: string, existingNames: string[], existingMinecraftNames: string[]): ClusterBundle {
  let raw: unknown
  try {
    raw = JSON.parse(fileContent)
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('That file does not contain a cluster backup.')
  }
  const candidate = raw as Partial<ClusterBundle>
  if (!Array.isArray(candidate.profiles) || !Array.isArray(candidate.minecraftProfiles) || !candidate.settings) {
    throw new Error('That file does not look like a valid cluster backup.')
  }

  const names = new Set(existingNames)
  const profiles = candidate.profiles.map((raw) => {
    const migrated = migrateProfile(raw as ServerProfile)
    const name = uniqueProfileName(migrated.name, [...names])
    names.add(name)
    return { ...migrated, id: randomUUID(), name }
  })

  const mcNames = new Set(existingMinecraftNames)
  const minecraftProfiles = candidate.minecraftProfiles.map((raw) => {
    const migrated = migrateMinecraftProfile(raw as MinecraftProfile)
    const name = uniqueProfileName(migrated.name, [...mcNames])
    mcNames.add(name)
    return { ...migrated, id: randomUUID(), name }
  })

  return {
    version: 1,
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : new Date().toISOString(),
    profiles,
    minecraftProfiles,
    settings: candidate.settings as AppSettings
  }
}
