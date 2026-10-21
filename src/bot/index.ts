import { Client, Events, GatewayIntentBits, REST, Routes, TextChannel } from 'discord.js'
import { loadConfig } from './config'
import { log } from './logging'
import { refreshStatusMessage, refreshMinecraftStatusMessage } from './statusRefresh'
import { buildPlayerJoinAlertEmbed } from './statusEmbeds'
import { checkSchedules } from './schedule'
import { checkCurseforgeUpdates } from './curseforgeCheck'
import { initMaintenanceState } from './maintenanceState'
import { initStatusMessageState } from './statusMessageState'
import { getCachedServers, serversForChatChannel } from './serverCache'
import { sendManagerRconCommand } from './managerApiClient'
import type { SlashCommand } from './commands/types'
import { statusCommands } from './commands/statusCommands'
import { maintenanceCommands } from './commands/maintenanceCommands'
import { scheduleCommands } from './commands/scheduleCommands'
import { adminCommands } from './commands/adminCommands'
import { managerCommands } from './commands/managerCommands'
import { curseforgeCommands } from './commands/curseforgeCommands'

const config = loadConfig()
initMaintenanceState(config.stateDir)
initStatusMessageState(config.stateDir)

const allCommands: SlashCommand[] = [
  ...statusCommands,
  ...maintenanceCommands,
  ...scheduleCommands,
  ...adminCommands,
  ...managerCommands,
  ...curseforgeCommands
]
const commandsByName = new Map(allCommands.map((c) => [c.data.name, c]))

// GuildMessages + MessageContent (both privileged - MessageContent must be turned on for
// this bot application in the Discord Developer Portal, under Bot > Privileged Gateway
// Intents, or every message's .content arrives as an empty string and the chat bridge below
// silently relays nothing) are only needed for the chat bridge (discordChatChannelId) - this
// bot otherwise still only uses slash commands and messages it sends itself, same as before.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] })

async function registerCommands(): Promise<void> {
  const rest = new REST().setToken(config.discordToken)
  const body = allCommands.map((c) => c.data.toJSON())
  const applicationId = client.application?.id
  if (!applicationId) throw new Error('Application id indisponible après connexion.')

  if (config.devGuildId) {
    const synced = (await rest.put(Routes.applicationGuildCommands(applicationId, config.devGuildId), { body })) as unknown[]
    log.info(`Commandes synchronisées instantanément sur le serveur ${config.devGuildId} (${synced.length} commande(s))`)
  } else {
    const synced = (await rest.put(Routes.applicationCommands(applicationId), { body })) as unknown[]
    log.info(`Commandes synchronisées globalement (${synced.length} commande(s)) — peut prendre jusqu'à 1h pour apparaître partout`)
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = commandsByName.get(interaction.commandName)
    if (!command) return
    try {
      await command.execute(interaction, { config, client })
    } catch (err) {
      log.error(`Erreur non gérée sur la commande slash /${interaction.commandName} : ${(err as Error).stack ?? (err as Error).message}`)
    }
    return
  }
  if (interaction.isAutocomplete()) {
    const command = commandsByName.get(interaction.commandName)
    if (!command?.autocomplete) return
    try {
      await command.autocomplete(interaction, { config, client })
    } catch (err) {
      log.error(`Erreur non gérée sur l'autocomplétion de /${interaction.commandName} : ${(err as Error).message}`)
    }
  }
})

// Chat bridge, inbound half (Discord -> game) - the outbound half (game -> Discord) is
// discordChatBridgeWatch.ts in the Manager's own main process, which posts into whichever
// channel a server's own discordChatChannelId names via the 'gameEvent' message type above.
// A message typed in that same channel gets relayed here to every ARK server currently
// configured with it (there can be more than one - a whole cluster sharing one channel) via
// RCON ServerChat, the same command /adminchat already uses.
client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) return
  if (!message.content.trim()) return
  const targets = serversForChatChannel(message.channelId, getCachedServers())
  if (targets.length === 0) return

  const formatted = `${message.author.displayName} (Discord) - ${message.content}`
  for (const server of targets) {
    sendManagerRconCommand(config, server.id, `ServerChat ${formatted}`)
      .then((result) => {
        if (!result.ok) log.warn(`Relais du chat vers '${server.name}' impossible : ${result.error ?? 'erreur inconnue'}`)
      })
      .catch((err: Error) => log.warn(`Relais du chat vers '${server.name}' impossible : ${err.message}`))
  }
})

client.once(Events.ClientReady, async () => {
  log.info(`Connecté en tant que ${client.user?.tag} (ID: ${client.user?.id})`)

  await registerCommands()

  if (config.statusChannelId && config.arkCheckEnabled) {
    void refreshStatusMessage(client, config)
    setInterval(() => void refreshStatusMessage(client, config), config.refreshSeconds * 1000)
  }
  if (config.mcStatusChannelId && config.mcCheckEnabled) {
    void refreshMinecraftStatusMessage(client, config)
    setInterval(() => void refreshMinecraftStatusMessage(client, config), config.mcRefreshSeconds * 1000)
  }
  setInterval(() => void checkSchedules(client, config), 30_000)

  if (config.curseforge.moduleEnabled && config.curseforge.apiKey) {
    setInterval(() => void checkCurseforgeUpdates(client, config), config.curseforge.checkIntervalMinutes * 60_000)
  } else {
    const reason = !config.curseforge.moduleEnabled ? 'module désactivé dans Settings' : 'clé API CurseForge manquante'
    log.info(
      `Module CurseForge désactivé (${reason}) — /setchannel, /addmod, /removemod, /listmods et /testmod répondront qu'il n'est pas configuré.`
    )
  }

  if (!config.maintenanceWhitelistIds.length) {
    log.warn(
      'La liste blanche de maintenance est vide : personne ne peut utiliser les commandes admin ' +
        '(/maintenance, /dinowipe, /saveworld, /adminchat, /rcon...). Configure-la dans Settings.'
    )
  }
  if (!config.managerWhitelistIds.length && !config.maintenanceWhitelistIds.length) {
    log.warn(
      'Aucune liste blanche Manager configurée : personne ne peut utiliser /start, /stop, /restart, /update, /updaterestart.'
    )
  }
})

function shutdown(): void {
  log.info('Arrêt du bot...')
  client.destroy().finally(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
const GAME_EVENT_PREFIXES: Record<string, string> = { tame: '🦖', kill: '💀', mission: '🎯' }

process.on('message', (message: unknown) => {
  if (typeof message !== 'object' || message === null) return
  const type = (message as { type?: string }).type
  if (type === 'stop') {
    shutdown()
    return
  }
  if (type === 'playerJoinAlert') {
    const { serverName, playerName, uniqueNetId } = message as { serverName: string; playerName: string; uniqueNetId: string }
    if (!config.playerAlertChannelId) return
    const channel = client.channels.cache.get(config.playerAlertChannelId)
    if (!channel || !(channel instanceof TextChannel)) {
      log.warn(`Alerte joueur ignorée : le salon ${config.playerAlertChannelId} est introuvable ou n'est pas un salon textuel.`)
      return
    }
    channel.send({ embeds: [buildPlayerJoinAlertEmbed(serverName, playerName, uniqueNetId)] }).catch((err: Error) => {
      log.error(`Envoi de l'alerte joueur impossible : ${err.message}`)
    })
  }
  if (type === 'gameEvent') {
    const { channelId, kind, text } = message as { channelId: string; kind: string; text: string }
    const channel = client.channels.cache.get(channelId)
    if (!channel || !(channel instanceof TextChannel)) {
      log.warn(`Événement de jeu ignoré : le salon ${channelId} est introuvable ou n'est pas un salon textuel.`)
      return
    }
    // 'chat' is posted as-is (its own text already reads "Player: message", a plain chat
    // bridge look) - the others get a small emoji prefix so they're quick to scan in an
    // events channel that can otherwise just be a wall of similarly-shaped lines.
    const prefix = GAME_EVENT_PREFIXES[kind] ?? ''
    channel
      .send((prefix ? `${prefix} ` : '') + text.slice(0, 2000 - prefix.length - 1))
      .catch((err: Error) => log.error(`Envoi de l'événement de jeu impossible : ${err.message}`))
  }
})

client.login(config.discordToken).catch((err) => {
  log.error(`Connexion à Discord impossible : ${(err as Error).message}`)
  process.exit(1)
})
