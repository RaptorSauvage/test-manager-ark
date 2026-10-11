import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js'
import { loadConfig } from './config'
import { log } from './logging'
import { refreshStatusMessage, refreshMinecraftStatusMessage } from './statusRefresh'
import { checkSchedules } from './schedule'
import { checkCurseforgeUpdates } from './curseforgeCheck'
import type { SlashCommand } from './commands/types'
import { statusCommands } from './commands/statusCommands'
import { maintenanceCommands } from './commands/maintenanceCommands'
import { scheduleCommands } from './commands/scheduleCommands'
import { adminCommands } from './commands/adminCommands'
import { managerCommands } from './commands/managerCommands'
import { curseforgeCommands } from './commands/curseforgeCommands'

const config = loadConfig()

const allCommands: SlashCommand[] = [
  ...statusCommands,
  ...maintenanceCommands,
  ...scheduleCommands,
  ...adminCommands,
  ...managerCommands,
  ...curseforgeCommands
]
const commandsByName = new Map(allCommands.map((c) => [c.data.name, c]))

// Aucun intent privilégié nécessaire - ce bot n'utilise que les commandes slash
// (interactions) et envoie des messages dans des salons qu'il a déjà en cache, il ne lit
// jamais le contenu des messages ni la liste des membres.
const client = new Client({ intents: [GatewayIntentBits.Guilds] })

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
process.on('message', (message: unknown) => {
  if (typeof message === 'object' && message !== null && (message as { type?: string }).type === 'stop') shutdown()
})

client.login(config.discordToken).catch((err) => {
  log.error(`Connexion à Discord impossible : ${(err as Error).message}`)
  process.exit(1)
})
