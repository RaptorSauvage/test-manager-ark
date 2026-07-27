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
    return { id: (entry as MapDefinition).id, displayName: (entry as MapDefinition).displayName }
  })
}

/** Reads a maps.json/customMaps.json-shaped file, creating it from `defaults` on first run and
 *  falling back to that same list (without touching the file) if it's been edited into something invalid. */
export function readMapDefinitionsFile(filePath: string, fileLabel: string, defaults: MapDefinition[]): MapDefinition[] {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(defaults, null, 2), 'utf-8')
    return defaults
  }

  try {
    return parseMapDefinitionsFile(fs.readFileSync(filePath, 'utf-8'), fileLabel)
  } catch (err) {
    console.error(`Ignoring invalid ${fileLabel} (${(err as Error).message}), using the built-in defaults instead.`)
    return defaults
  }
}
