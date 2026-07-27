import ini from 'ini'
import type { OfficialServerStatusData } from '@shared/types'

/**
 * Official ARK:SA server status feed, published by Wildcard/Snail Games. The exact
 * section/key names aren't documented anywhere - this parses it as a generic INI file
 * (section -> key -> value) instead of assuming specific names, so it keeps working
 * even if this guess doesn't match the real structure and needs adjusting later.
 */
export const OFFICIAL_SERVER_STATUS_URL = 'https://cdn2.arkdedicated.com/asa/officialserverstatus.ini'

/** Values seen in the wild (and their ARK:SE-era equivalents) that plausibly mean "up"/"down". */
const UP_VALUES = new Set(['1', 'true', 'up', 'online', 'ok', 'active'])
const DOWN_VALUES = new Set(['0', 'false', 'down', 'offline', 'inactive'])

/** Best-effort up/down guess for a status value; undefined when it can't be guessed. */
export function guessIsUp(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase()
  if (UP_VALUES.has(normalized)) return true
  if (DOWN_VALUES.has(normalized)) return false
  return undefined
}

/** Parses the raw .ini content into section -> key -> value, flattening non-section top-level keys under "general". */
export function parseOfficialServerStatus(content: string): OfficialServerStatusData {
  const parsed = ini.parse(content) as Record<string, unknown>
  const result: OfficialServerStatusData = {}

  for (const [key, value] of Object.entries(parsed)) {
    if (value && typeof value === 'object') {
      const section: Record<string, string> = {}
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        section[subKey] = String(subValue)
      }
      result[key] = section
    } else {
      result.general = result.general ?? {}
      result.general[key] = String(value)
    }
  }

  return result
}

export async function fetchOfficialServerStatus(): Promise<OfficialServerStatusData> {
  const response = await fetch(OFFICIAL_SERVER_STATUS_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch official server status (HTTP ${response.status})`)
  }
  const content = await response.text()
  return parseOfficialServerStatus(content)
}
