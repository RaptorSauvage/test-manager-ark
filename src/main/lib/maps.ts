import path from 'node:path'
import type { MapDefinition } from '@shared/types'
import { getDataDir } from './dataDir'
import { parseMapDefinitionsFile, readMapDefinitionsFile } from './jsonListFile'

/** Where the editable maps list lives - see getDataDir() for why it's not next to the Manager. */
export function getMapsFilePath(): string {
  return path.join(getDataDir(), 'maps.json')
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
  return parseMapDefinitionsFile(content, 'maps.json')
}

/** Reads the maps list, creating it from the default seed on first run and falling back
 *  to that same seed (without touching the file) if it's been edited into something invalid. */
export function listMaps(): MapDefinition[] {
  return readMapDefinitionsFile(getMapsFilePath(), 'maps.json', getDefaultMaps())
}
