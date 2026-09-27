import path from 'node:path'
import type { MapDefinition } from '@shared/types'
import type { GameId } from '@shared/games'
import { getDataDir } from './dataDir'
import { parseMapDefinitionsFile, readMapDefinitionsFile } from './jsonListFile'

/** Where the editable maps list lives - see getDataDir() for why it's not next to the
 *  Manager. ARK: Survival Ascended keeps the original 'maps.json' name (no existing install's
 *  file needs to move); every other game gets its own '<data dir>/maps-<gameId>.json'. */
export function getMapsFilePath(game: GameId): string {
  const fileName = game === 'ark-ascended' ? 'maps.json' : `maps-${game}.json`
  return path.join(getDataDir(), fileName)
}

/**
 * Seed list written the first time the app runs for a given game, so the map selector isn't
 * empty out of the box. Anything else (DLC maps not listed here, modded/custom maps) can be
 * added by editing that game's maps file directly, without an app update.
 */
export function getDefaultMaps(game: GameId): MapDefinition[] {
  if (game === 'ark-evolved') {
    return [
      { id: 'TheIsland', displayName: 'The Island' },
      { id: 'TheCenter', displayName: 'The Center' },
      { id: 'ScorchedEarth_P', displayName: 'Scorched Earth' },
      { id: 'Ragnarok', displayName: 'Ragnarok' },
      { id: 'Aberration_P', displayName: 'Aberration' },
      { id: 'Extinction', displayName: 'Extinction' },
      { id: 'Valguero_P', displayName: 'Valguero' },
      { id: 'CrystalIsles', displayName: 'Crystal Isles' },
      { id: 'Genesis', displayName: 'Genesis Part.I' },
      { id: 'Gen2', displayName: 'Genesis Part.II' },
      { id: 'LostIsland', displayName: 'Lost Island' },
      { id: 'Fjordur', displayName: 'Fjordur' }
    ]
  }
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

/** Reads `game`'s maps list, creating it from that game's default seed on first run and
 *  falling back to that same seed (without touching the file) if it's been edited into
 *  something invalid. */
export function listMaps(game: GameId): MapDefinition[] {
  return readMapDefinitionsFile(getMapsFilePath(game), 'maps.json', getDefaultMaps(game))
}
