import { ActivityType, type Client, type Message, TextChannel } from 'discord.js'
import type { DiscordBotConfig } from '@shared/discordBot'
import { refreshServerCache, arkServers, minecraftServers } from './serverCache'
import { queryEosStatus, queryOfficialNetworkStatus, queryAwsStatus, queryCloudflareStatus, queryXboxStatus, queryMinecraftAuthStatus } from './externalStatus'
import { buildStatusEmbed, buildMinecraftStatusEmbed } from './statusEmbeds'
import { getArkMaintenance, isBotMaintenanceMode } from './maintenanceState'
import { log } from './logging'

let statusMessage: Message | null = null
let mcStatusMessage: Message | null = null

/** Port of `update_bot_presence` - the bot's own Discord activity text, independent of
 *  whichever channel embeds are posted to. */
export async function updateBotPresence(client: Client): Promise<void> {
  const servers = arkServers()
  if (isBotMaintenanceMode()) {
    const botName = client.user?.username ?? 'Bot'
    client.user?.setActivity(`${botName} est en maintenance`, { type: ActivityType.Custom })
    return
  }
  if (servers.length > 0 && servers.every((s) => getArkMaintenance(s.id))) {
    client.user?.setActivity('🔧 Cluster en maintenance', { type: ActivityType.Custom })
    return
  }
  const totalPlayers = servers.reduce((sum, s) => (s.state === 'running' ? sum + s.players.length : sum), 0)
  client.user?.setActivity(`Surveille ${totalPlayers} survivant${totalPlayers !== 1 ? 's' : ''}`, { type: ActivityType.Custom })
}

/** Récupère le statut complet et met à jour (ou crée) le message dans le salon dédié - port
 *  de `refresh_status_message`. */
export async function refreshStatusMessage(client: Client, config: DiscordBotConfig): Promise<void> {
  if (!config.statusChannelId) return
  const channel = client.channels.cache.get(config.statusChannelId)
  if (!channel || !(channel instanceof TextChannel)) {
    log.warn(`Salon statusChannelId=${config.statusChannelId} introuvable.`)
    return
  }

  const me = channel.guild.members.me
  const perms = me ? channel.permissionsFor(me) : null
  if (!perms?.has('ViewChannel') || !perms.has('SendMessages') || !perms.has('EmbedLinks')) {
    log.warn(
      `Permissions insuffisantes sur le salon statusChannelId=${config.statusChannelId} (${channel.name}) : ` +
        "vérifie 'Voir le salon', 'Envoyer des messages' et 'Intégrer des liens'."
    )
    return
  }

  const [servers, eos, official, aws, cloudflare] = await Promise.all([
    refreshServerCache(config),
    queryEosStatus(),
    queryOfficialNetworkStatus(),
    queryAwsStatus(),
    queryCloudflareStatus()
  ])
  await updateBotPresence(client)
  const embed = buildStatusEmbed(arkServers(servers), [eos[0], aws[0], cloudflare[0], official[0]], config)

  if (!statusMessage) {
    try {
      const history = await channel.messages.fetch({ limit: 20 })
      statusMessage = history.find((m) => m.author.id === client.user?.id && m.embeds.length > 0) ?? null
    } catch {
      log.warn(
        `Impossible de lire l'historique du salon statusChannelId=${config.statusChannelId} ` +
          "(permission 'Lire l'historique des messages' manquante). Un nouveau message sera créé à la place."
      )
    }
  }

  try {
    if (statusMessage) {
      await statusMessage.edit({ embeds: [embed] })
    } else {
      statusMessage = await channel.send({ embeds: [embed] })
    }
  } catch (err) {
    try {
      statusMessage = await channel.send({ embeds: [embed] })
    } catch {
      log.warn(
        `Impossible d'envoyer/éditer le message dans statusChannelId=${config.statusChannelId} ` +
          `(permissions manquantes : vérifie 'Envoyer des messages' et 'Intégrer des liens'). ${(err as Error).message}`
      )
    }
  }
}

/** Port de `refresh_minecraft_status_message`. */
export async function refreshMinecraftStatusMessage(client: Client, config: DiscordBotConfig): Promise<void> {
  if (!config.mcStatusChannelId) return
  const servers = minecraftServers()
  if (servers.length === 0) return

  const channel = client.channels.cache.get(config.mcStatusChannelId)
  if (!channel || !(channel instanceof TextChannel)) {
    log.warn(`Salon mcStatusChannelId=${config.mcStatusChannelId} introuvable.`)
    return
  }

  const me = channel.guild.members.me
  const perms = me ? channel.permissionsFor(me) : null
  if (!perms?.has('ViewChannel') || !perms.has('SendMessages') || !perms.has('EmbedLinks')) {
    log.warn(
      `Permissions insuffisantes sur le salon mcStatusChannelId=${config.mcStatusChannelId} (${channel.name}) : ` +
        "vérifie 'Voir le salon', 'Envoyer des messages' et 'Intégrer des liens'."
    )
    return
  }

  const [xbox, cloudflare, aws, mcAuth] = await Promise.all([
    queryXboxStatus(),
    queryCloudflareStatus(),
    queryAwsStatus(),
    queryMinecraftAuthStatus()
  ])
  const embed = buildMinecraftStatusEmbed(servers, [xbox[0], cloudflare[0], aws[0], mcAuth[0]], config)

  if (!mcStatusMessage) {
    try {
      const history = await channel.messages.fetch({ limit: 20 })
      mcStatusMessage = history.find((m) => m.author.id === client.user?.id && m.embeds.length > 0) ?? null
    } catch {
      log.warn(
        `Impossible de lire l'historique du salon mcStatusChannelId=${config.mcStatusChannelId} ` +
          "(permission 'Lire l'historique des messages' manquante). Un nouveau message sera créé à la place."
      )
    }
  }

  try {
    if (mcStatusMessage) {
      await mcStatusMessage.edit({ embeds: [embed] })
    } else {
      mcStatusMessage = await channel.send({ embeds: [embed] })
    }
  } catch (err) {
    try {
      mcStatusMessage = await channel.send({ embeds: [embed] })
    } catch {
      log.warn(
        `Impossible d'envoyer/éditer le message dans mcStatusChannelId=${config.mcStatusChannelId} ` +
          `(permissions manquantes : vérifie 'Envoyer des messages' et 'Intégrer des liens'). ${(err as Error).message}`
      )
    }
  }
}
