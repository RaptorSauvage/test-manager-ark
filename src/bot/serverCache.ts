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
  cached = await fetchManagerServers(config)
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
