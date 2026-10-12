import type { ArkModInfoMap, ArkModSearchResult } from '@shared/types'
import { searchCurseForgeArkMods, getCurseForgeMods, type CurseForgeMod } from './curseforgeClient'
import { getSettings } from '../store'

function toSearchResult(mod: CurseForgeMod): ArkModSearchResult {
  return {
    id: String(mod.id),
    name: mod.name,
    summary: mod.summary,
    iconUrl: mod.logo?.thumbnailUrl ?? undefined,
    downloads: mod.downloadCount
  }
}

/**
 * Searches CurseForge for ARK: Survival Ascended mods by name, for the ARK Mods tab's own
 * "Search CurseForge" section - purely to help find a mod's real id/name instead of hunting
 * for a bare numeric id elsewhere (CurseForge's own mod page, a wiki, ...), since ARK mods
 * aren't actually downloaded/installed through this app the way Minecraft mods are - the
 * server fetches its own mods by id at startup, this app only ever writes the id out via
 * -mods=/-passivemods= (see gameConfigWrite.ts). Returns an empty list (not an error) when no
 * CurseForge API key is configured - the caller decides what to show for that, same as the
 * Minecraft Mods tab's own search does for hasCurseForgeKey.
 */
export async function searchArkMods(query: string): Promise<ArkModSearchResult[]> {
  const apiKey = getSettings().curseforgeApiKey.trim()
  if (!apiKey) return []
  const hits = await searchCurseForgeArkMods(apiKey, query)
  return hits.map(toSearchResult)
}

/**
 * Batch look-up of a name/icon for ARK: Survival Ascended mod ids already in a profile's mods
 * list - covers ids typed in by hand or added before this feature existed, not just ones added
 * via searchArkMods above, so the table can show a real name/icon next to every row rather than
 * only ones added through search. Ids CurseForge doesn't recognize (not a real/still-published
 * project, or - for an ARK: Survival Evolved profile, whose mod ids are an entirely different
 * Steam Workshop namespace this never has any business being called for - just not a
 * CurseForge id at all) are silently absent from the result map rather than an error; callers
 * fall back to showing the bare id for those. Empty map, no request made, when no CurseForge
 * API key is configured.
 */
export async function getArkModsInfo(modIds: string[]): Promise<ArkModInfoMap> {
  const apiKey = getSettings().curseforgeApiKey.trim()
  if (!apiKey) return {}
  const numericIds = [...new Set(modIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))]
  if (numericIds.length === 0) return {}
  const mods = await getCurseForgeMods(apiKey, numericIds)
  const info: ArkModInfoMap = {}
  for (const mod of mods) {
    info[String(mod.id)] = { name: mod.name, iconUrl: mod.logo?.thumbnailUrl ?? undefined }
  }
  return info
}
