import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { MapDefinition } from '@shared/types'

/**
 * Where the editable maps list lives - the user's Documents folder, not next to the
 * Manager executable. electron-builder's NSIS installer runs the previous version's
 * uninstaller as part of an update, which does an unconditional `RMDir /r $INSTDIR` -
 * anything living next to the exe (like this used to) would be wiped out by that on every
 * update. Documents is untouched by both that and a portable-exe swap, while staying just
 * as easy to find and edit as "next to the Manager" was meant to be.
 */
export function getMapsFilePath(): string {
  return path.join(app.getPath('documents'), 'ARK Server Manager', 'maps.json')
}

/**
 * Seed list written the first time the app runs, so the map selector isn't empty out of
 * the box. Anything else (DLC maps not listed here, modded/custom maps) can be added by
 * editing maps.json directly, without an app update.
 */
export function getDefaultMaps(): MapDefinition[] {
  return [
    { id: 'TheIsland_WP', displayName: 'The Island' },
    { id: 'ScorchedEarth_WP', displayName: 'Scorched Earth' },
    { id: 'Aberration_WP', displayName: 'Aberration' },
    { id: 'Extinction_WP', displayName: 'Extinction' },
    { id: 'Genesis_WP', displayName: 'Genesis Part.I' },
    { id: 'Gen2_WP', displayName: 'Genesis Part.II' },
    { id: 'LostColony_WP', displayName: 'Lost Colony' },
    { id: 'TheCenter_WP', displayName: 'The Center' },
    { id: 'Ragnarok_WP', displayName: 'Ragnarok' },
    { id: 'CrystalIsles_WP', displayName: 'Crystal Isles' },
    { id: 'LostIsland_WP', displayName: 'Lost Island' },
    { id: 'Fjordur_WP', displayName: 'Fjordur' },
    { id: 'Dragontopia_WP', displayName: 'Dragontopia' },
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
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
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
