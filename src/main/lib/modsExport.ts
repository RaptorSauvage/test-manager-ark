import type { ServerMod } from '@shared/types'

export function serializeMods(mods: ServerMod[]): string {
  return JSON.stringify(mods, null, 2)
}

/** Parses and validates a mod list file, throwing a clear error if it's malformed. Missing
 *  enabled/passive/dev flags default the same way profileMigration backfills them. */
export function parseImportedMods(fileContent: string): ServerMod[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(fileContent)
  } catch {
    throw new Error('Mod list file is not valid JSON.')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Mod list file must contain a JSON array.')
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || typeof (entry as Record<string, unknown>).id !== 'string') {
      throw new Error(`Mod list entry ${index} is missing a string "id".`)
    }
    const raw = entry as Partial<ServerMod> & { id: string }
    return {
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      enabled: raw.enabled ?? true,
      passive: raw.passive ?? false,
      dev: raw.dev ?? false
    }
  })
}
