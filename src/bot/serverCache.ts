import type { DiscordBotConfig, ManagerServerInfo } from '@shared/discordBot'
import { fetchManagerServers } from './managerApiClient'

// A short-lived cache of the Manager's own server list - refreshed on every status/embed
// cycle, and read directly by autocomplete/admin commands in between so a slash command
// typed a second after the last refresh doesn't have to wait on its own round trip. Unlike
// the standalone bot (a static SERVERS list read once from .env at startup), this list can
// genuinely change at runtime (a profile added/removed/renamed in the Manager), so nothing
// here is assumed to stay valid longer than the next refresh.
let cached: ManagerServerInfo[] = []

export function getCachedServers(): ManagerServerInfo[] {
  return cached
}

export async function refreshServerCache(config: DiscordBotConfig): Promise<ManagerServerInfo[]> {
  // Filtered here, once, rather than at each call site below - a server with
  // discordBotExcluded set is meant to be invisible to the bot entirely (status embeds,
  // presence, admin commands, autocomplete, the chat bridge), and every one of those reads
  // from this same cache (directly or via arkServers/minecraftServers/findServerByName/
  // serversForChatChannel below).
  cached = (await fetchManagerServers(config)).filter((s) => !s.discordBotExcluded)
  return cached
}

export function findServerByName(name: string): ManagerServerInfo | undefined {
  const lower = name.toLowerCase()
  return cached.find((s) => s.name.toLowerCase() === lower)
}

export function arkServers(servers: ManagerServerInfo[] = cached): ManagerServerInfo[] {
  return servers.filter((s) => s.gameDisplayName !== 'Minecraft')
}

export function minecraftServers(servers: ManagerServerInfo[] = cached): ManagerServerInfo[] {
  return servers.filter((s) => s.gameDisplayName === 'Minecraft')
}

/** Every ARK server currently configured to relay chat from `channelId` (there can be more
 *  than one - a whole cluster sharing one channel, each profile's own
 *  ServerProfile.discordChatChannelId set to the same value) - the inbound half of the chat
 *  bridge in index.ts uses this to find who a Discord message should be relayed to. Pure/
 *  testable on its own, same as arkServers/minecraftServers above. */
export function serversForChatChannel(channelId: string, servers: ManagerServerInfo[] = cached): ManagerServerInfo[] {
  return arkServers(servers).filter((s) => s.discordChatChannelId === channelId)
}
