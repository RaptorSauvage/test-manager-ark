import type { ServerMod } from '@shared/types'

/** One mod id per line - deliberately just bare ids, not full ServerMod JSON (enabled/name/
 *  passive/dev used to round-trip through this). A mod's real name is either resolved
 *  automatically from CurseForge (ARK: Survival Ascended's own Mods tab enrichment - see
 *  arkMods.ts) or typed in by hand afterward (ARK: Survival Evolved, which has no CurseForge
 *  data to resolve from) either way, so there was no reason to carry a name snapshot along
 *  with the id - and dropping it turns this from a closed loop (only ever re-importable from
 *  this app's own previous export) into something you can paste in from wherever a mod id list
 *  already exists: a wiki page, a Discord message, a friend's own modpack list. */
export function serializeMods(mods: ServerMod[]): string {
  return mods.map((m) => m.id).join('\n')
}

/**
 * Parses a pasted mod id list. Deliberately forgiving about the exact separator - one id per
 * line is the canonical shape serializeMods produces, but splitting on any run of non-digit
 * characters also accepts a list copied as "123, 456 789" or similar, since the whole point is
 * accepting an id list from wherever the user actually found it, not just this app's own
 * previous export. Every id becomes a fresh entry with the same defaults addMod's own manual
 * single-id path already uses (enabled, not passive, not dev) - not a snapshot of whatever
 * enabled/passive/dev state the id might have carried the last time it was copied, which could
 * easily be stale or simply not apply to this profile.
 */
export function parseImportedMods(text: string): ServerMod[] {
  const ids = text.split(/[^0-9]+/).filter((id) => id.length > 0)
  if (ids.length === 0) {
    throw new Error('No mod ids found - paste a list of numeric mod ids, one per line (or separated by commas/spaces).')
  }

  const seen = new Set<string>()
  const mods: ServerMod[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    mods.push({ id, enabled: true, passive: false, dev: false })
  }
  return mods
}
