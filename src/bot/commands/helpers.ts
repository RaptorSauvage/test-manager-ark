import type { ManagerServerInfo } from '@shared/discordBot'

export function serverNotFoundMessage(name: string, servers: ManagerServerInfo[]): string {
  const noms = servers.map((s) => s.name).join(', ')
  return `⚠️ Serveur \`${name}\` introuvable. Serveurs disponibles : ${noms}`
}

export async function autocompleteServerNames(current: string, servers: ManagerServerInfo[]): Promise<{ name: string; value: string }[]> {
  const lower = current.toLowerCase()
  return servers
    .filter((s) => s.name.toLowerCase().includes(lower))
    .slice(0, 25)
    .map((s) => ({ name: s.name, value: s.name }))
}
