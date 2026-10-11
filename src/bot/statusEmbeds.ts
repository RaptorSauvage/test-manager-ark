import { EmbedBuilder } from 'discord.js'
import type { DiscordBotConfig, ManagerServerInfo } from '@shared/discordBot'
import {
  getArkMaintenance,
  getMcMaintenance,
  isCheckDisabled,
  type MaintenanceEntry
} from './maintenanceState'

/** Parses a hex color (with or without '#') into the number discord.js's EmbedBuilder wants,
 *  falling back to the given default on anything invalid - same reasoning as the standalone
 *  bot's own `_parse_hex_color` (a typo'd STATUS_EMBED_COLOR shouldn't crash embed building). */
export function parseHexColor(value: string | undefined, defaultHex = '9B59B6'): number {
  const raw = (value ?? '').trim().replace(/^#/, '')
  const candidate = raw || defaultHex
  const parsed = Number.parseInt(candidate, 16)
  if (Number.isNaN(parsed)) return Number.parseInt(defaultHex, 16)
  return parsed
}

/** The Manager's own server states and how this bot labels/colors them - every server's
 *  status now comes from the Manager API, so unlike the standalone bot (RCON-only, unable to
 *  tell "starting" apart from "offline"), every one of these is always distinguishable. */
export const MANAGER_STATE_LABELS: Record<string, { icon: string; label: string }> = {
  stopped: { icon: '🔴', label: 'Arrêté' },
  starting: { icon: '🟡', label: 'Démarrage en cours' },
  running: { icon: '🟢', label: 'En ligne' },
  stopping: { icon: '🟠', label: 'Arrêt en cours' },
  restarting: { icon: '🟡', label: 'Redémarrage en cours' },
  updating: { icon: '🔵', label: 'Mise à jour en cours' },
  error: { icon: '🔴', label: 'Erreur' }
}

function maintenanceLabel(entry: MaintenanceEntry): string {
  return entry.reason ? `En maintenance - ${entry.reason}` : 'En maintenance'
}

function playerCountLabel(server: ManagerServerInfo): string {
  if (server.maxPlayers > 0) return `${server.players.length}/${server.maxPlayers} joueurs`
  return `${server.players.length} joueur${server.players.length !== 1 ? 's' : ''}`
}

function serverLine(server: ManagerServerInfo, maintenance: MaintenanceEntry | undefined): string {
  if (maintenance) return `🔧  **${server.name}** - ${maintenanceLabel(maintenance)}`
  if (server.state === 'running') return `🟢  **${server.name}** - ${playerCountLabel(server)}`
  const { icon, label } = MANAGER_STATE_LABELS[server.state] ?? { icon: '⚪', label: server.state }
  return `${icon}  **${server.name}** - ${label}`
}

/** Groups servers by the Manager's own `group` field (the same grouping already shown on
 *  the desktop Dashboard/Cluster Dashboard - e.g. a "Testing" group kept apart from the
 *  main "Cluster" one), preserving the order servers already arrive in (which `/api/servers`
 *  already returns pre-sorted by group) rather than re-sorting - so same-group servers stay
 *  contiguous and groups appear in the same order they do in the Manager itself, with no
 *  separate "group order" setting to fetch just for this. An empty group name (a profile
 *  with no group set) falls back to the "Cluster" label, matching the Manager's own default. */
function groupServersByGroup(servers: ManagerServerInfo[]): Map<string, ManagerServerInfo[]> {
  const groups = new Map<string, ManagerServerInfo[]>()
  for (const server of servers) {
    const key = server.group.trim() || 'Cluster'
    const existing = groups.get(key)
    if (existing) existing.push(server)
    else groups.set(key, [server])
  }
  return groups
}

export function playersFieldValue(names: string[]): string {
  if (names.length === 0) return 'Aucun joueur connecté'
  const shown = names.slice(0, 30)
  let text = shown.map((n) => `• ${n}`).join('\n')
  if (names.length > shown.length) text += `\n… et ${names.length - shown.length} de plus`
  return text
}

export function buildStatusEmbed(
  servers: ManagerServerInfo[],
  systemExtraLines: string[],
  config: DiscordBotConfig
): EmbedBuilder {
  const visible = servers.filter((s) => !isCheckDisabled(s.id))
  const maintenanceCount = visible.filter((s) => getArkMaintenance(s.id)).length
  const onlineCount = visible.filter((s) => s.state === 'running' && !getArkMaintenance(s.id)).length
  const offlineCount = visible.length - onlineCount - maintenanceCount
  const totalPlayers = visible.reduce((sum, s) => (s.state === 'running' ? sum + s.players.length : sum), 0)

  const statusParts: string[] = []
  if (offlineCount > 0) statusParts.push(`${offlineCount} hors ligne`)
  if (maintenanceCount > 0) statusParts.push(`${maintenanceCount} en maintenance`)
  const statusSuffix = statusParts.length > 0 ? ` (${statusParts.join(', ')})` : ''

  let clusterIcon: string
  let clusterLabel: string
  if (onlineCount > 0) {
    clusterIcon = '🟢'
    clusterLabel = `En ligne${statusSuffix}`
  } else if (maintenanceCount > 0 && offlineCount === 0) {
    clusterIcon = '🔧'
    clusterLabel = `En maintenance${statusSuffix}`
  } else {
    clusterIcon = '🔴'
    clusterLabel = `Hors ligne${statusSuffix}`
  }
  const clusterStatusLine = `${clusterIcon}  **Status Cluster** - ${clusterLabel}`

  const groups = groupServersByGroup(visible)
  const groupFields =
    groups.size > 0
      ? [...groups.entries()].map(([groupName, groupServers]) => ({
          name: `📡 ${groupName}`,
          value: groupServers.map((s) => serverLine(s, getArkMaintenance(s.id))).join('\n'),
          inline: false
        }))
      : [{ name: '📡 Cluster', value: 'Aucun serveur configuré', inline: false }]

  const embed = new EmbedBuilder()
    .setTitle(config.statusEmbedTitle)
    .setColor(parseHexColor(config.statusEmbedColor))
    .setTimestamp()
    .addFields(
      { name: '🖥️ Système', value: [clusterStatusLine, ...systemExtraLines].join('\n'), inline: false },
      ...groupFields
    )
    .setFooter({ text: `${onlineCount}/${visible.length} serveur(s) en ligne · ${totalPlayers} joueur(s) au total` })

  if (config.statusEmbedDescription) embed.setDescription(config.statusEmbedDescription)
  return embed
}

export function buildMinecraftStatusEmbed(
  servers: ManagerServerInfo[],
  systemLines: string[],
  config: DiscordBotConfig
): EmbedBuilder {
  const visible = servers.filter((s) => !isCheckDisabled(s.id))
  const maintenanceCount = visible.filter((s) => getMcMaintenance(s.id)).length
  const onlineCount = visible.filter((s) => s.state === 'running' && !getMcMaintenance(s.id)).length
  const totalPlayers = visible.reduce(
    (sum, s) => (s.state === 'running' && !getMcMaintenance(s.id) ? sum + s.players.length : sum),
    0
  )

  const mcServerLine = (s: ManagerServerInfo): string => {
    const maintenance = getMcMaintenance(s.id)
    if (maintenance) return `🔧  **${s.name}** - ${maintenanceLabel(maintenance)}`
    if (s.state === 'running') return `🟢  **${s.name}** - ${playerCountLabel(s)}`
    return `🔴  **${s.name}** - Hors ligne`
  }

  const groups = groupServersByGroup(visible)
  const groupFields =
    groups.size > 0
      ? [...groups.entries()].map(([groupName, groupServers]) => ({
          name: `⛏️ ${groupName}`,
          value: groupServers.map(mcServerLine).join('\n'),
          inline: false
        }))
      : [{ name: '⛏️ Liste des serveurs', value: 'Aucun serveur configuré', inline: false }]

  const footerParts = [`${onlineCount}/${visible.length} serveur(s) en ligne`, `${totalPlayers} joueur(s) au total`]
  if (maintenanceCount > 0) footerParts.push(`${maintenanceCount} en maintenance`)

  const embed = new EmbedBuilder()
    .setTitle(config.mcStatusEmbedTitle)
    .setColor(parseHexColor(config.mcStatusEmbedColor))
    .setTimestamp()
    .addFields({ name: '🖥️ Système', value: systemLines.join('\n'), inline: false }, ...groupFields)
    .setFooter({ text: footerParts.join(' · ') })

  if (config.mcStatusEmbedDescription) embed.setDescription(config.mcStatusEmbedDescription)
  return embed
}

/** Detailed single-server embed for `/statusserveur` and `/statusmc` detail views - `isMc`
 *  only changes the footer/description wording ("RCON" never appears anymore: everything is
 *  sourced from the Manager API now, see README). */
export function buildServerDetailEmbed(server: ManagerServerInfo, maintenance: MaintenanceEntry | undefined, disabled: boolean): EmbedBuilder {
  if (maintenance) {
    const embed = new EmbedBuilder()
      .setTitle(`🔧 ${server.name} — En maintenance`)
      .setColor(0xe67e22)
      .setTimestamp()
      .setFooter({ text: "Via l'API du Manager · Dernière vérification" })
    if (maintenance.reason) embed.addFields({ name: 'Raison', value: maintenance.reason, inline: false })
    return embed
  }

  if (disabled) {
    return new EmbedBuilder()
      .setTitle(`⚫ ${server.name} — Check désactivé`)
      .setDescription(
        `Ce serveur est exclu du suivi Discord (\`/check off\`) — utilise \`/check on serveur:${server.name}\` pour le réactiver.`
      )
      .setColor(0x5a5a5a)
      .setTimestamp()
      .setFooter({ text: "Via l'API du Manager · Dernière vérification" })
  }

  if (server.state !== 'running') {
    const { icon, label } = MANAGER_STATE_LABELS[server.state] ?? { icon: '⚪', label: server.state }
    const transitional = ['starting', 'stopping', 'restarting', 'updating'].includes(server.state)
    const embed = new EmbedBuilder()
      .setTitle(`${icon} ${server.name} — ${label}`)
      .setDescription(`Statut rapporté par l'ARK Server Manager : \`${server.state}\`.`)
      .setColor(transitional ? 0xe67e22 : 0xe74c3c)
      .setTimestamp()
      .setFooter({ text: "Via l'API du Manager · Dernière vérification" })
    if (server.gameVersion) embed.addFields({ name: 'Version', value: server.gameVersion, inline: true })
    return embed
  }

  const countLabel = server.maxPlayers > 0 ? `${server.players.length} / ${server.maxPlayers}` : String(server.players.length)
  const embed = new EmbedBuilder()
    .setTitle(`🟢 ${server.name} — En ligne`)
    .setColor(0x2ecc71)
    .setTimestamp()
    .setFooter({ text: "Via l'API du Manager · Dernière vérification" })
  embed.addFields({ name: 'Joueurs', value: countLabel, inline: true })
  if (server.gameVersion) embed.addFields({ name: 'Version', value: server.gameVersion, inline: true })
  embed.addFields({ name: 'Liste des joueurs', value: playersFieldValue(server.players), inline: false })
  return embed
}
