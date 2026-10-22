import fs from 'node:fs'
import path from 'node:path'
import type { MapDefinition } from '@shared/types'

/** Parses and validates a maps.json/customMaps.json-shaped file, throwing a clear error if malformed. */
export function parseMapDefinitionsFile(content: string, fileLabel: string): MapDefinition[] {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    throw new Error(`${fileLabel} is not valid JSON.`)
  }

  if (!Array.isArray(raw)) {
    throw new Error(`${fileLabel} must contain a JSON array.`)
  }

  return raw.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as Record<string, unknown>).id !== 'string' ||
      typeof (entry as Record<string, unknown>).displayName !== 'string'
    ) {
      throw new Error(`${fileLabel} entry ${index} must be an object with string "id" and "displayName" fields.`)
    }
    const modId = (entry as Record<string, unknown>).modId
    return {
      id: (entry as MapDefinition).id,
      displayName: (entry as MapDefinition).displayName,
      ...(typeof modId === 'string' && modId.trim() ? { modId } : {})
    }
  })
}

/** Writes a maps.json/customMaps.json-shaped file - used by customMaps.ts's add/update/
 *  delete, which always read the current list first (via readMapDefinitionsFile) and write
 *  the whole array back, same read-modify-write pattern as the rest of this file-backed
 *  config (settings, profiles). */
export function writeMapDefinitionsFile(filePath: string, maps: MapDefinition[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(maps, null, 2), 'utf-8')
}

/** Reads a maps.json/customMaps.json-shaped file, creating it from `defaults` on first run and
 *  falling back to that same list (without touching the file) if it's been edited into something invalid. */
export function readMapDefinitionsFile(filePath: string, fileLabel: string, defaults: MapDefinition[]): MapDefinition[] {
  if (!fs.existsSync(filePath)) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify(defaults, null, 2), 'utf-8')
    } catch (err) {
      // Best-effort - this function's job is to hand the caller a valid map list, not to
      // guarantee the file got created. A disk-level failure here (see this session's other
      // fixes for the same real report) still leaves the in-memory defaults perfectly usable.
      console.error(`Failed to create ${fileLabel} (using the built-in defaults instead):`, (err as Error).message)
    }
    return defaults
  }

  try {
    return parseMapDefinitionsFile(fs.readFileSync(filePath, 'utf-8'), fileLabel)
  } catch (err) {
    console.error(`Ignoring invalid ${fileLabel} (${(err as Error).message}), using the built-in defaults instead.`)
    return defaults
  }
}
