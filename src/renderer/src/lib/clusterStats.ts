import type { ServerProfile, ServerStatus } from '@shared/types'

export interface ClusterGroupStats {
  /** Trimmed ServerProfile.group - empty string for the "Ungrouped" bucket. */
  group: string
  /** The group's member profiles, in the same order they were given - handed back so a
   *  caller (e.g. opening a merged group console) doesn't need to re-derive the same
   *  bucketing a second time. */
  profiles: ServerProfile[]
  serverCount: number
  runningCount: number
  totalCpu: number
  totalMemoryMB: number
  totalPlayers: number
  totalMaxPlayers: number
}

/**
 * Groups visible profiles the same way the Dashboard does (by trimmed ServerProfile.group,
 * "" for ungrouped, hidden profiles excluded entirely) and sums each group's live stats.
 * A server that isn't currently running contributes nothing to the numeric totals (its
 * cpu/memory/players are stale or undefined) but still counts toward serverCount, so a
 * group's totals reflect what's actually running right now, not what's configured.
 * Groups are sorted alphabetically with the ungrouped bucket (if any) always last.
 */
export function computeClusterGroupStats(
  profiles: ServerProfile[],
  statuses: Record<string, ServerStatus>
): ClusterGroupStats[] {
  const groups = new Map<string, ServerProfile[]>()
  for (const profile of profiles) {
    if (profile.hidden) continue
    const key = profile.group.trim()
    const list = groups.get(key)
    if (list) list.push(profile)
    else groups.set(key, [profile])
  }

  const stats = Array.from(groups.entries()).map(([group, groupProfiles]) => {
    let runningCount = 0
    let totalCpu = 0
    let totalMemoryMB = 0
    let totalPlayers = 0
    let totalMaxPlayers = 0
    for (const profile of groupProfiles) {
      totalMaxPlayers += profile.maxPlayers
      const status = statuses[profile.id]
      if (status?.state === 'running') {
        runningCount++
        totalCpu += status.cpu ?? 0
        totalMemoryMB += status.memoryMB ?? 0
        totalPlayers += status.players?.length ?? 0
      }
    }
    return {
      group,
      profiles: groupProfiles,
      serverCount: groupProfiles.length,
      runningCount,
      totalCpu,
      totalMemoryMB,
      totalPlayers,
      totalMaxPlayers
    }
  })

  return stats.sort((a, b) => {
    if (a.group === '') return 1
    if (b.group === '') return -1
    return a.group.localeCompare(b.group)
  })
}
