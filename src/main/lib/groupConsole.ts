import type { GroupConsoleEvent, ServerProfile } from '@shared/types'
import { watchLogFile } from './serverProcess'
import { parseLogChunk, createLogEventCaches, readLogBacklog } from './logEvents'

/**
 * Reads each given profile's recent backlog independently (see readLogBacklog), tags every
 * event with which profile it came from, and merges them into one list sorted by timestamp -
 * no per-label filtering here (unlike the web dashboard's own backlog reader), since the
 * Cluster Data group console filters what it displays entirely on its own, independent of
 * the web dashboard's persisted per-label toggle.
 */
export function getGroupConsoleBacklog(profiles: ServerProfile[]): GroupConsoleEvent[] {
  const tagged: GroupConsoleEvent[] = []
  for (const profile of profiles) {
    for (const event of readLogBacklog(profile.installDir)) {
      tagged.push({ ...event, profileId: profile.id, profileName: profile.name })
    }
  }
  return tagged.sort((a, b) => a.ts.localeCompare(b.ts))
}

/**
 * Starts tailing every given profile's log independently (one `watchLogFile` per profile,
 * same primitive every other log-following feature in this app already uses concurrently),
 * calling `onEvent` for each newly-parsed line as it's written, tagged with which profile it
 * came from. Returns a function that stops every one of those tailers - call it once the
 * group console page consuming them goes away.
 */
export function watchGroupConsole(
  profiles: ServerProfile[],
  onEvent: (event: GroupConsoleEvent) => void,
  intervalMs?: number
): () => void {
  const stopFns = profiles.map((profile) => {
    let caches = createLogEventCaches()
    const onChunk = (chunk: string, rotated: boolean): void => {
      if (rotated) caches = createLogEventCaches()
      for (const event of parseLogChunk(chunk, caches)) {
        onEvent({ ...event, profileId: profile.id, profileName: profile.name })
      }
    }
    return intervalMs === undefined
      ? watchLogFile(profile.installDir, onChunk)
      : watchLogFile(profile.installDir, onChunk, intervalMs)
  })
  return () => {
    for (const stop of stopFns) stop()
  }
}
