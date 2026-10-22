import path from 'node:path'
import type { MapDefinition } from '@shared/types'
import { getDataDir } from './dataDir'
import { parseMapDefinitionsFile, readMapDefinitionsFile, writeMapDefinitionsFile } from './jsonListFile'

/** Where the editable custom/modded maps list lives - see getDataDir() for the exact folder. */
export function getCustomMapsFilePath(): string {
  return path.join(getDataDir(), 'customMaps.json')
}

/**
 * Custom/modded maps are user-specific (tied to whatever Workshop mods they use), so unlike
 * maps.json there's no real seed list to start from - each entry's `id` is a real map
 * identifier (exactly like an official map's), shown in the Map selector's "Custom" group
 * alongside maps.json's "Official" one.
 */
export function getDefaultCustomMaps(): MapDefinition[] {
  return []
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

function normalizeEntry(entry: { id: string; displayName: string; modId?: string }): MapDefinition {
  const id = entry.id.trim()
  const displayName = entry.displayName.trim()
  if (!id || !displayName) throw new Error('A map needs both an id and a display name.')
  const modId = entry.modId?.trim()
  return modId ? { id, displayName, modId } : { id, displayName }
}

/** Appends a new custom/modded map - the Map Manager's "+ Add Map" (Tools menu). Throws on a
 *  blank id/name or on an id already used by another custom map. */
export function addCustomMap(entry: { id: string; displayName: string; modId?: string }): MapDefinition[] {
  const normalized = normalizeEntry(entry)
  const maps = listCustomMaps()
  if (maps.some((m) => m.id === normalized.id)) {
    throw new Error(`A custom map with id "${normalized.id}" already exists.`)
  }
  const next = [...maps, normalized]
  writeMapDefinitionsFile(getCustomMapsFilePath(), next)
  return next
}

/** Edits an existing custom map in place, identified by its id before the edit (which may
 *  itself be changing the id). Throws if the original isn't found, or the new id collides
 *  with a different existing entry. */
export function updateCustomMap(originalId: string, entry: { id: string; displayName: string; modId?: string }): MapDefinition[] {
  const normalized = normalizeEntry(entry)
  const maps = listCustomMaps()
  const index = maps.findIndex((m) => m.id === originalId)
  if (index === -1) throw new Error(`No custom map with id "${originalId}" found.`)
  if (normalized.id !== originalId && maps.some((m) => m.id === normalized.id)) {
    throw new Error(`A custom map with id "${normalized.id}" already exists.`)
  }
  const next = maps.slice()
  next[index] = normalized
  writeMapDefinitionsFile(getCustomMapsFilePath(), next)
  return next
}

/** Removes a custom map by id - a no-op (not an error) if it's already gone, same
 *  forgiving-delete behavior as profiles.delete. */
export function deleteCustomMap(id: string): MapDefinition[] {
  const maps = listCustomMaps()
  const next = maps.filter((m) => m.id !== id)
  writeMapDefinitionsFile(getCustomMapsFilePath(), next)
  return next
}
