import path from 'node:path'
import type { MapDefinition } from '@shared/types'
import { getDataDir } from './dataDir'
import { parseMapDefinitionsFile, readMapDefinitionsFile } from './jsonListFile'

/** Where the editable custom/modded maps list lives - see getDataDir() for the exact folder. */
export function getCustomMapsFilePath(): string {
  return path.join(getDataDir(), 'customMaps.json')
}

/**
 * Custom/modded maps are user-specific (tied to whatever Workshop mods they use), so unlike
 * maps.json there's no real seed list - just a "None" entry (empty id, disables Mod Map)
 * so the dropdown always has a way to opt out, followed by whatever the user adds.
 */
export function getDefaultCustomMaps(): MapDefinition[] {
  return [{ id: '', displayName: 'None' }]
}

/** Parses and validates customMaps.json content, throwing a clear error if it's malformed. */
export function parseCustomMapsFile(content: string): MapDefinition[] {
  return parseMapDefinitionsFile(content, 'customMaps.json')
}

/** Reads the custom maps list, creating an empty file on first run and falling back to an
 *  empty list (without touching the file) if it's been edited into something invalid. */
export function listCustomMaps(): MapDefinition[] {
  return readMapDefinitionsFile(getCustomMapsFilePath(), 'customMaps.json', getDefaultCustomMaps())
}
