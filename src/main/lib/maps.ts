import fs from 'node:fs'
import path from 'node:path'
import type { MapDefinition } from '@shared/types'
import { getManagerBaseDir } from './steamcmdInstaller'

/** Where the editable maps list lives - next to the Manager, so it's easy to find and edit. */
export function getMapsFilePath(): string {
  return path.join(getManagerBaseDir(), 'maps.json')
}

/**
 * Seed list written the first time the app runs, so the map selector isn't empty out of
 * the box. These are the exact SavedArks folder names confirmed against a real ARK:SA
 * install - not guessed. Anything else (DLC maps not listed here, modded/custom maps) can
 * be added by editing maps.json directly, without an app update.
 */
export function getDefaultMaps(): MapDefinition[] {
  return [
    { id: 'TheIsland_WP', displayName: 'The Island' },
    { id: 'ScorchedEarth_WP', displayName: 'Scorched Earth' },
    { id: 'TheCenter_WP', displayName: 'The Center' },
    { id: 'Ragnarok_WP', displayName: 'Ragnarok' },
    { id: 'Aberration_WP', displayName: 'Aberration' },
    { id: 'Extinction_WP', displayName: 'Extinction' },
    { id: 'Genesis_WP', displayName: 'Genesis' },
    { id: 'Valguero_WP', displayName: 'Valguero' },
    { id: 'LostColony_WP', displayName: 'Lost Colony' },
    { id: 'Astraeos_WP', displayName: 'Astraeos' }
  ]
}

/** Parses and validates maps.json content, throwing a clear error if it's malformed. */
export function parseMapsFile(content: string): MapDefinition[] {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    throw new Error('maps.json is not valid JSON.')
  }

  if (!Array.isArray(raw)) {
    throw new Error('maps.json must contain a JSON array.')
  }

  return raw.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as Record<string, unknown>).id !== 'string' ||
      typeof (entry as Record<string, unknown>).displayName !== 'string'
    ) {
      throw new Error(`maps.json entry ${index} must be an object with string "id" and "displayName" fields.`)
    }
    return { id: (entry as MapDefinition).id, displayName: (entry as MapDefinition).displayName }
  })
}

/** Reads the maps list, creating it from the default seed on first run and falling back
 *  to that same seed (without touching the file) if it's been edited into something invalid. */
export function listMaps(): MapDefinition[] {
  const filePath = getMapsFilePath()
  if (!fs.existsSync(filePath)) {
    const defaults = getDefaultMaps()
    fs.writeFileSync(filePath, JSON.stringify(defaults, null, 2), 'utf-8')
    return defaults
  }

  try {
    return parseMapsFile(fs.readFileSync(filePath, 'utf-8'))
  } catch (err) {
    console.error(`Ignoring invalid maps.json (${(err as Error).message}), using the built-in defaults instead.`)
    return getDefaultMaps()
  }
}
