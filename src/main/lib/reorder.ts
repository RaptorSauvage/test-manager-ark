import type { ServerProfile } from '@shared/types'

/**
 * Reorders `profiles` to match `orderedIds`. Ids in `orderedIds` that don't match any
 * profile are ignored; profiles not mentioned in `orderedIds` keep their original
 * relative order, appended at the end.
 */
export function reorderProfiles(profiles: ServerProfile[], orderedIds: string[]): ServerProfile[] {
  const byId = new Map(profiles.map((p) => [p.id, p]))
  const reordered: ServerProfile[] = []

  for (const id of orderedIds) {
    const profile = byId.get(id)
    if (profile) {
      reordered.push(profile)
      byId.delete(id)
    }
  }

  reordered.push(...byId.values())
  return reordered
}
