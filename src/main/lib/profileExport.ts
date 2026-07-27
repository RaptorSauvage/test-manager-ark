import { randomUUID } from 'node:crypto'
import type { ServerProfile } from '@shared/types'
import { migrateProfile } from './profileMigration'
import { uniqueProfileName } from './detect'

/** Pretty-printed JSON for a single profile, suitable for writing straight to a file. */
export function serializeProfile(profile: ServerProfile): string {
  return JSON.stringify(profile, null, 2)
}

/**
 * Parses a previously exported profile file back into a ServerProfile ready to add to
 * this install: run through the same migration as profiles loaded from the store (so an
 * export from an older app version still works), given a fresh id, and a name that won't
 * collide with an existing profile.
 */
export function parseImportedProfile(fileContent: string, existingNames: string[]): ServerProfile {
  let raw: unknown
  try {
    raw = JSON.parse(fileContent)
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('That file does not contain a server profile.')
  }

  const migrated = migrateProfile(raw as ServerProfile)
  if (!migrated.installDir || !migrated.map) {
    throw new Error('That file does not look like a valid server profile export.')
  }

  return {
    ...migrated,
    id: randomUUID(),
    name: uniqueProfileName(migrated.name, existingNames)
  }
}
