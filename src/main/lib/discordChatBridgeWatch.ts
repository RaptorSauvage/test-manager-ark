import type { ServerStatus, ServerProfile, LogEvent } from '@shared/types'
import { isRunning, serverEvents, watchLogFile } from './serverProcess'
import { getProfile, listProfiles } from '../store'
import { parseLogChunk, createLogEventCaches } from './logEvents'
import { notifyGameEvent } from './discordBot'

const stopFns = new Map<string, () => void>()

/**
 * True for a KILL event that looks like a tamed dino's death rather than a wild-vs-wild one.
 * ARK logs a tamed dino's death with its custom name and level ("MyRex - Lvl 150 (Rex) was
 * killed..."), while a wild dino's own death line only ever shows its raw species/blueprint
 * name - never a level. Best-effort heuristic (there's no way to verify this against a real
 * server's log from here) rather than a documented format, but it's what the user explicitly
 * asked to filter to: posting every wild-on-wild death (hundreds a day on an active server)
 * would make the events channel unreadable.
 */
export function isTamedDinoKillEvent(text: string): boolean {
  return / - Lvl \d+/.test(text)
}

/** Routes one already-parsed log event to the right Discord channel (if any) for the profile
 *  it came from - CHAT always goes to discordChatChannelId when set; TAME/MISSION/a tamed-
 *  dino KILL go to discordEventsChannelId when set. Every other label (JOIN/LEFT/WARN/CRYO/
 *  SAVE/CMD/READY, and a wild-dino KILL) is deliberately left alone - this is a chat bridge
 *  and a tame/death/mission feed, not a general-purpose log relay. */
export function routeGameEvent(profile: ServerProfile, event: LogEvent): void {
  if (event.label === 'CHAT') {
    if (profile.discordChatChannelId) notifyGameEvent(profile.discordChatChannelId, 'chat', event.text)
    return
  }
  if (!profile.discordEventsChannelId) return
  if (event.label === 'TAME') notifyGameEvent(profile.discordEventsChannelId, 'tame', event.text)
  else if (event.label === 'MISSION') notifyGameEvent(profile.discordEventsChannelId, 'mission', event.text)
  else if (event.label === 'KILL' && isTamedDinoKillEvent(event.text)) {
    notifyGameEvent(profile.discordEventsChannelId, 'kill', event.text)
  }
}

export function stopDiscordChatBridgeWatch(profileId: string): void {
  const fn = stopFns.get(profileId)
  if (fn) {
    fn()
    stopFns.delete(profileId)
  }
}

/** Starts tailing profile.installDir's log for chat/tame/kill/mission lines, if this profile
 *  actually has a chat or events channel configured - a no-op otherwise, so a profile with
 *  neither set costs nothing beyond the one settings read. Safe to call for an already-
 *  running server adopted at app startup, same as playerJoinAlertWatch.ts's own
 *  start*Watch. */
export function startDiscordChatBridgeWatch(profile: ServerProfile): void {
  stopDiscordChatBridgeWatch(profile.id)
  if (!profile.discordChatChannelId && !profile.discordEventsChannelId) return

  let caches = createLogEventCaches()
  stopFns.set(
    profile.id,
    watchLogFile(profile.installDir, (chunk, rotated) => {
      if (rotated) caches = createLogEventCaches()
      for (const event of parseLogChunk(chunk, caches)) routeGameEvent(profile, event)
    })
  )
}

/** Re-evaluates the watch for a profile right after its Settings are saved, so adding/
 *  clearing either channel id takes effect immediately on an already-running server instead
 *  of only on its next restart. No-op if the server isn't running. */
export function syncDiscordChatBridgeWatch(profile: ServerProfile): void {
  if (!isRunning(profile.id)) return
  if (profile.discordChatChannelId || profile.discordEventsChannelId) startDiscordChatBridgeWatch(profile)
  else stopDiscordChatBridgeWatch(profile.id)
}

/** Starts/stops the per-server watch alongside the server's own lifecycle - wired off
 *  serverEvents so it self-cleans on a crash too, not just an explicit Stop/Kill. Call once
 *  at app startup. */
export function registerDiscordChatBridgeWatch(): void {
  serverEvents.on('status', (status: ServerStatus) => {
    if (status.state === 'starting') {
      const profile = getProfile(status.profileId)
      if (profile) startDiscordChatBridgeWatch(profile)
    } else if (status.state === 'stopped' || status.state === 'error') {
      stopDiscordChatBridgeWatch(status.profileId)
    }
  })
}

/** Re-syncs every currently-running ARK profile at once - unlike playerJoinAlertWatch.ts's
 *  equivalent (one global Settings toggle), this is per-profile, but a bulk resync is still
 *  useful right after an import/export or similar bulk profile change. */
export function syncAllDiscordChatBridgeWatches(): void {
  for (const profile of listProfiles()) syncDiscordChatBridgeWatch(profile)
}
