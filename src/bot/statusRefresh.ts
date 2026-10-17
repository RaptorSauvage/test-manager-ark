import { ActivityType, type Client, type Message, TextChannel } from 'discord.js'
import type { DiscordBotConfig } from '@shared/discordBot'
import { refreshServerCache, arkServers, minecraftServers } from './serverCache'
import { queryEosStatus, queryOfficialNetworkStatus, queryAwsStatus, queryCloudflareStatus, queryXboxStatus, queryMinecraftAuthStatus } from './externalStatus'
import { buildStatusEmbed, buildMinecraftStatusEmbed } from './statusEmbeds'
import { getArkMaintenance, isBotMaintenanceMode } from './maintenanceState'
import {
  getPersistedStatusMessageId,
  setPersistedStatusMessageId,
  getPersistedMcStatusMessageId,
  setPersistedMcStatusMessageId
} from './statusMessageState'
import { log } from './logging'

let statusMessage: Message | null = null
let mcStatusMessage: Message | null = null

/** Reacquires the real status message across a bot restart (statusMessage/mcStatusMessage
 *  above are in-memory only and reset to null every restart - see statusMessageState.ts's own
 *  doc comment for why that used to cause duplicate messages). Tries the exact persisted id
 *  first (precise, no guessing); only falls back to scanning the last 20 messages for one of
 *  the bot's own embeds if there's no persisted id yet (upgrading from before this existed) or
 *  the persisted message was deleted - and persists whatever it finds/creates either way, so
 *  this guessing is at most a one-time cost per channel. */
async function reacquireStatusMessage(
  channel: TextChannel,
  client: Client,
  getPersistedId: () => string | null,
  setPersistedId: (id: string | null) => void
): Promise<Message | null> {
  const persistedId = getPersistedId()
  if (persistedId) {
    try {
      return await channel.messages.fetch(persistedId)
    } catch {
      // Deleted, or the channel changed - fall through to the history search below.
    }
  }
  try {
    const history = await channel.messages.fetch({ limit: 20 })
    const found = history.find((m) => m.author.id === client.user?.id && m.embeds.length > 0) ?? null
    if (found) setPersistedId(found.id)
    return found
  } catch {
    log.warn(
      `Impossible de lire l'historique du salon ${channel.id} ` +
        "(permission 'Lire l'historique des messages' manquante). Un nouveau message sera créé à la place."
    )
    return null
  }
}

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
    statusMessage = await reacquireStatusMessage(channel, client, getPersistedStatusMessageId, setPersistedStatusMessageId)
  }

  try {
    if (statusMessage) {
      await statusMessage.edit({ embeds: [embed] })
    } else {
      statusMessage = await channel.send({ embeds: [embed] })
      setPersistedStatusMessageId(statusMessage.id)
    }
  } catch (err) {
    try {
      statusMessage = await channel.send({ embeds: [embed] })
      setPersistedStatusMessageId(statusMessage.id)
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
    mcStatusMessage = await reacquireStatusMessage(channel, client, getPersistedMcStatusMessageId, setPersistedMcStatusMessageId)
  }

  try {
    if (mcStatusMessage) {
      await mcStatusMessage.edit({ embeds: [embed] })
    } else {
      mcStatusMessage = await channel.send({ embeds: [embed] })
      setPersistedMcStatusMessageId(mcStatusMessage.id)
    }
  } catch (err) {
    try {
      mcStatusMessage = await channel.send({ embeds: [embed] })
      setPersistedMcStatusMessageId(mcStatusMessage.id)
    } catch {
      log.warn(
        `Impossible d'envoyer/éditer le message dans mcStatusChannelId=${config.mcStatusChannelId} ` +
          `(permissions manquantes : vérifie 'Envoyer des messages' et 'Intégrer des liens'). ${(err as Error).message}`
      )
    }
  }
}
