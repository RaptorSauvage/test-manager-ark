import { SlashCommandBuilder } from 'discord.js'
import { refreshServerCache, arkServers, minecraftServers, findServerByName } from '../serverCache'
import { managerApiPost, ManagerApiError } from '../managerApiClient'
import { checkManagerWhitelist } from '../permissions'
import { serverNotFoundMessage, autocompleteServerNames } from './helpers'
import { log } from '../logging'
import type { SlashCommand } from './types'

async function allServers(config: Parameters<typeof refreshServerCache>[0]) {
  const servers = await refreshServerCache(config)
  return [...arkServers(servers), ...minecraftServers(servers)]
}

function makeManagerActionCommand(
  name: string,
  description: string,
  path: string,
  verb: string,
  icon: string,
  actionLabel: string
): SlashCommand {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .addStringOption((opt) => opt.setName('serveur').setDescription(`Serveur à ${verb}`).setRequired(true).setAutocomplete(true)),
    async execute(interaction, { config }) {
      if (!(await checkManagerWhitelist(interaction, config))) return
      const serveur = interaction.options.getString('serveur', true)
      const servers = await allServers(config)
      const target = findServerByName(serveur)
      if (!target) {
        await interaction.reply({ content: serverNotFoundMessage(serveur, servers), ephemeral: true })
        return
      }

      await interaction.deferReply()
      try {
        await managerApiPost(config, `/api/servers/${target.id}/${path}`)
        log.info(`${name} demandé sur '${target.name}' par ${interaction.user.tag} via l'API du Manager`)
        await interaction.followUp(`${icon} ${actionLabel} demandé pour **${target.name}**. Utilise \`/status\` pour suivre l'état.`)
      } catch (err) {
        if (err instanceof ManagerApiError) {
          await interaction.followUp(`❌ ${err.message}`)
          return
        }
        throw err
      }
    },
    async autocomplete(interaction, { config }) {
      await refreshServerCache(config)
      const current = interaction.options.getFocused()
      await interaction.respond(await autocompleteServerNames(current, [...arkServers(), ...minecraftServers()]))
    }
  }
}

const startCommand = makeManagerActionCommand('start', 'Démarre un serveur via le Manager', 'start', 'démarrer', '🟢', 'Démarrage')
const stopCommand = makeManagerActionCommand('stop', 'Arrête un serveur via le Manager', 'stop', 'arrêter', '🔴', 'Arrêt')
const restartCommand = makeManagerActionCommand('restart', 'Redémarre un serveur via le Manager', 'restart', 'redémarrer', '🔄', 'Redémarrage')

const updateCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('update')
    .setDescription('Met à jour un serveur via SteamCMD (Manager) - il doit déjà être arrêté')
    .addStringOption((opt) => opt.setName('serveur').setDescription('Serveur à mettre à jour').setRequired(true).setAutocomplete(true)),
  async execute(interaction, { config }) {
    if (!(await checkManagerWhitelist(interaction, config))) return
    const serveur = interaction.options.getString('serveur', true)
    const servers = await allServers(config)
    const target = findServerByName(serveur)
    if (!target) {
      await interaction.reply({ content: serverNotFoundMessage(serveur, servers), ephemeral: true })
      return
    }

    await interaction.deferReply()
    try {
      await managerApiPost(config, `/api/servers/${target.id}/update`)
      log.info(`update demandé sur '${target.name}' par ${interaction.user.tag} via l'API du Manager`)
      await interaction.followUp(
        `📦 Mise à jour SteamCMD demandée pour **${target.name}** (échoue silencieusement si le serveur est ` +
          "encore en cours d'exécution - arrête-le d'abord, ou utilise `/updaterestart` qui fait les trois étapes)."
      )
    } catch (err) {
      if (err instanceof ManagerApiError) {
        await interaction.followUp(`❌ ${err.message}`)
        return
      }
      throw err
    }
  },
  async autocomplete(interaction, { config }) {
    await refreshServerCache(config)
    const current = interaction.options.getFocused()
    await interaction.respond(await autocompleteServerNames(current, [...arkServers(), ...minecraftServers()]))
  }
}

const updateRestartCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('updaterestart')
    .setDescription('Arrête, met à jour via SteamCMD, puis redémarre un serveur (Manager)')
    .addStringOption((opt) => opt.setName('serveur').setDescription('Serveur à arrêter, mettre à jour, puis redémarrer').setRequired(true).setAutocomplete(true)),
  async execute(interaction, { config }) {
    if (!(await checkManagerWhitelist(interaction, config))) return
    const serveur = interaction.options.getString('serveur', true)
    const servers = await allServers(config)
    const target = findServerByName(serveur)
    if (!target) {
      await interaction.reply({ content: serverNotFoundMessage(serveur, servers), ephemeral: true })
      return
    }

    await interaction.deferReply()
    try {
      await managerApiPost(config, `/api/servers/${target.id}/stop-update-restart`)
      log.info(`Stop+Update+Restart demandé sur '${target.name}' par ${interaction.user.tag} via l'API du Manager`)
      await interaction.followUp(`♻️ Stop+Update+Restart demandé pour **${target.name}**. Utilise \`/status\` pour suivre l'état.`)
    } catch (err) {
      if (err instanceof ManagerApiError) {
        await interaction.followUp(`❌ ${err.message}`)
        return
      }
      throw err
    }
  },
  async autocomplete(interaction, { config }) {
    await refreshServerCache(config)
    const current = interaction.options.getFocused()
    await interaction.respond(await autocompleteServerNames(current, [...arkServers(), ...minecraftServers()]))
  }
}

export const managerCommands: SlashCommand[] = [startCommand, stopCommand, restartCommand, updateCommand, updateRestartCommand]
