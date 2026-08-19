import type { GroupConsoleEvent, ServerProfile, ServerStatus } from '@shared/types'
import { watchLogFile, serverEvents, isRunning } from './serverProcess'
import { parseLogChunkWithDate, createLogEventCaches, readLogBacklog } from './logEvents'

function sortKey(event: GroupConsoleEvent): string {
  return `${event.date} ${event.ts}`
}

/**
 * Reads each given profile's recent backlog independently (see readLogBacklog), tags every
 * event with which profile it came from, and merges them into one list sorted by date+time
 * (not just time - a single server's backlog can itself span more than a day, so HH:MM:SS
 * alone isn't enough to merge multiple servers' backlogs correctly). No per-label filtering
 * here (unlike the web dashboard's own backlog reader), since the Cluster Data group console
 * filters what it displays entirely on its own, independent of the web dashboard's persisted
 * per-label toggle.
 */
export function getGroupConsoleBacklog(profiles: ServerProfile[]): GroupConsoleEvent[] {
  const tagged: GroupConsoleEvent[] = []
  for (const profile of profiles) {
    for (const event of readLogBacklog(profile.installDir)) {
      tagged.push({ ...event, profileId: profile.id, profileName: profile.name })
    }
  }
  return tagged.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
}

/**
 * Starts tailing every given profile's log, but only for as long as that particular profile
 * is actually running - a stopped server's log isn't growing anyway, but this also means a
 * server that stops while the console is open immediately stops contributing new events, and
 * one that starts (or was already running) picks up live tailing right away, all wired off
 * the same status events every other per-server watcher in this app already reacts to. Each
 * tailer is independent (one `watchLogFile` per running profile), calling `onEvent` for every
 * newly-parsed line, tagged with which profile it came from. Returns a function that stops
 * everything and unsubscribes - call it once the group console page consuming this goes away.
 */
export function watchGroupConsole(
  profiles: ServerProfile[],
  onEvent: (event: GroupConsoleEvent) => void,
  intervalMs = 2000,
  isRunningFn: (profileId: string) => boolean = isRunning
): () => void {
  const activeStops = new Map<string, () => void>()
  const profileById = new Map(profiles.map((p) => [p.id, p]))

  function start(profile: ServerProfile): void {
    if (activeStops.has(profile.id)) return
    let caches = createLogEventCaches()
    const stop = watchLogFile(
      profile.installDir,
      (chunk, rotated) => {
        if (rotated) caches = createLogEventCaches()
        for (const event of parseLogChunkWithDate(chunk, caches)) {
          onEvent({ ...event, profileId: profile.id, profileName: profile.name })
        }
      },
      intervalMs
    )
    activeStops.set(profile.id, stop)
  }

  function stop(profileId: string): void {
    activeStops.get(profileId)?.()
    activeStops.delete(profileId)
  }

  for (const profile of profiles) {
    if (isRunningFn(profile.id)) start(profile)
  }

  function onStatus(status: ServerStatus): void {
    const profile = profileById.get(status.profileId)
    if (!profile) return
    if (status.state === 'running') start(profile)
    else stop(profile.id)
  }
  serverEvents.on('status', onStatus)

  return () => {
    serverEvents.off('status', onStatus)
    for (const profileId of Array.from(activeStops.keys())) stop(profileId)
  }
}
