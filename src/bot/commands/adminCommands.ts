import { SlashCommandBuilder } from 'discord.js'
import { refreshServerCache, arkServers, findServerByName } from '../serverCache'
import { sendManagerRconCommand } from '../managerApiClient'
import { checkMaintenanceWhitelist } from '../permissions'
import { serverNotFoundMessage, autocompleteServerNames } from './helpers'
import { log } from '../logging'
import type { SlashCommand } from './types'

const dinowipeCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('dinowipe')
    .setDescription('⚠️ Supprime tous les dinosaures sauvages (DestroyWildDinos) sur un serveur')
    .addStringOption((opt) => opt.setName('serveur').setDescription('Serveur sur lequel exécuter DestroyWildDinos').setRequired(true).setAutocomplete(true)),
  async execute(interaction, { config }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    const serveur = interaction.options.getString('serveur', true)
    await refreshServerCache(config)
    const target = findServerByName(serveur)
    if (!target) {
      await interaction.reply({ content: serverNotFoundMessage(serveur, arkServers()), ephemeral: true })
      return
    }

    await interaction.deferReply()
    const result = await sendManagerRconCommand(config, target.id, 'DestroyWildDinos')
    log.info(`DestroyWildDinos exécuté sur '${target.name}' par ${interaction.user.tag} (succès=${result.ok})`)

    if (result.ok) {
      await interaction.followUp(`🦖 **DestroyWildDinos** exécuté sur **${target.name}**.\n\`\`\`${result.response || 'OK'}\`\`\``)
    } else {
      await interaction.followUp(`❌ Échec de **DestroyWildDinos** sur **${target.name}** : ${result.error}`)
    }
  },
  async autocomplete(interaction, { config }) {
    await refreshServerCache(config)
    const current = interaction.options.getFocused()
    await interaction.respond(await autocompleteServerNames(current, arkServers()))
  }
}

const saveworldCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('saveworld')
    .setDescription('Sauvegarde immédiatement le monde (SaveWorld) sur un serveur')
    .addStringOption((opt) => opt.setName('serveur').setDescription('Serveur sur lequel exécuter SaveWorld').setRequired(true).setAutocomplete(true)),
  async execute(interaction, { config }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    const serveur = interaction.options.getString('serveur', true)
    await refreshServerCache(config)
    const target = findServerByName(serveur)
    if (!target) {
      await interaction.reply({ content: serverNotFoundMessage(serveur, arkServers()), ephemeral: true })
      return
    }

    await interaction.deferReply()
    const result = await sendManagerRconCommand(config, target.id, 'SaveWorld')
    log.info(`SaveWorld exécuté sur '${target.name}' par ${interaction.user.tag} (succès=${result.ok})`)

    if (result.ok) {
      await interaction.followUp(`💾 **SaveWorld** exécuté sur **${target.name}**.\n\`\`\`${result.response || 'OK'}\`\`\``)
    } else {
      await interaction.followUp(`❌ Échec de **SaveWorld** sur **${target.name}** : ${result.error}`)
    }
  },
  async autocomplete(interaction, { config }) {
    await refreshServerCache(config)
    const current = interaction.options.getFocused()
    await interaction.respond(await autocompleteServerNames(current, arkServers()))
  }
}

const adminchatCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('adminchat')
    .setDescription('Envoie un message dans le chat du serveur via RCON (ServerChat)')
    .addStringOption((opt) => opt.setName('serveur').setDescription('Serveur sur lequel envoyer le message').setRequired(true).setAutocomplete(true))
    .addStringOption((opt) => opt.setName('message').setDescription('Message à envoyer').setRequired(true)),
  async execute(interaction, { config }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    const serveur = interaction.options.getString('serveur', true)
    const message = interaction.options.getString('message', true)
    await refreshServerCache(config)
    const target = findServerByName(serveur)
    if (!target) {
      await interaction.reply({ content: serverNotFoundMessage(serveur, arkServers()), ephemeral: true })
      return
    }

    await interaction.deferReply()
    const formattedMessage = `Console - ${message}`
    const result = await sendManagerRconCommand(config, target.id, `ServerChat ${formattedMessage}`)
    log.info(`ServerChat exécuté sur '${target.name}' par ${interaction.user.tag} (succès=${result.ok}) : ${formattedMessage}`)

    if (result.ok) {
      await interaction.followUp(`💬 Message envoyé sur **${target.name}** :\n> ${formattedMessage}`)
    } else {
      await interaction.followUp(`❌ Échec de l'envoi sur **${target.name}** : ${result.error}`)
    }
  },
  async autocomplete(interaction, { config }) {
    await refreshServerCache(config)
    const current = interaction.options.getFocused()
    await interaction.respond(await autocompleteServerNames(current, arkServers()))
  }
}

const adminchatallCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('adminchatall')
    .setDescription('Envoie un message dans le chat de TOUS les serveurs du cluster via RCON')
    .addStringOption((opt) => opt.setName('message').setDescription('Message à envoyer sur tous les serveurs').setRequired(true)),
  async execute(interaction, { config }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    const message = interaction.options.getString('message', true)
    await interaction.deferReply()
    const formattedMessage = `Console - ${message}`

    const servers = await refreshServerCache(config)
    const targets = arkServers(servers)
    const results = await Promise.all(
      targets.map((server) => sendManagerRconCommand(config, server.id, `ServerChat ${formattedMessage}`))
    )

    const lines = targets.map((server, i) => {
      const result = results[i]
      log.info(`ServerChat exécuté sur '${server.name}' par ${interaction.user.tag} (succès=${result.ok}) : ${formattedMessage}`)
      const icon = result.ok ? '✅' : '❌'
      return `${icon} **${server.name}**${result.ok ? '' : ` - ${result.error}`}`
    })

    await interaction.followUp(`💬 Message envoyé sur tout le cluster :\n> ${formattedMessage}\n\n${lines.join('\n')}`)
  }
}

const rconCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('rcon')
    .setDescription('⚠️ Envoie une commande RCON brute à un serveur précis')
    .addStringOption((opt) => opt.setName('serveur').setDescription('Serveur cible').setRequired(true).setAutocomplete(true))
    .addStringOption((opt) => opt.setName('commande').setDescription('Commande RCON à exécuter telle quelle').setRequired(true)),
  async execute(interaction, { config }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    const serveur = interaction.options.getString('serveur', true)
    const commande = interaction.options.getString('commande', true)
    await refreshServerCache(config)
    const target = findServerByName(serveur)
    if (!target) {
      await interaction.reply({ content: serverNotFoundMessage(serveur, [...arkServers()]), ephemeral: true })
      return
    }

    await interaction.deferReply()
    const result = await sendManagerRconCommand(config, target.id, commande)
    log.info(`RCON brut exécuté sur '${target.name}' par ${interaction.user.tag} (succès=${result.ok}) : ${commande}`)

    if (result.ok) {
      await interaction.followUp(`🖥️ Commande exécutée sur **${target.name}** :\n> \`${commande}\`\n\`\`\`${result.response || 'OK'}\`\`\``)
    } else {
      await interaction.followUp(`❌ Échec sur **${target.name}** : ${result.error}`)
    }
  },
  async autocomplete(interaction, { config }) {
    await refreshServerCache(config)
    const current = interaction.options.getFocused()
    await interaction.respond(await autocompleteServerNames(current, arkServers()))
  }
}

const rconallCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('rconall')
    .setDescription('⚠️ Envoie une commande RCON brute à TOUS les serveurs du cluster')
    .addStringOption((opt) => opt.setName('commande').setDescription('Commande RCON à exécuter telle quelle sur tous les serveurs').setRequired(true)),
  async execute(interaction, { config }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    const commande = interaction.options.getString('commande', true)
    await interaction.deferReply()

    const servers = await refreshServerCache(config)
    const targets = arkServers(servers)
    const results = await Promise.all(targets.map((server) => sendManagerRconCommand(config, server.id, commande)))

    const lines = targets.map((server, i) => {
      const result = results[i]
      log.info(`RCON brut exécuté sur '${server.name}' par ${interaction.user.tag} (succès=${result.ok}) : ${commande}`)
      const icon = result.ok ? '✅' : '❌'
      return `${icon} **${server.name}**${result.ok ? '' : ` - ${result.error}`}`
    })

    await interaction.followUp(`🖥️ Commande exécutée sur tout le cluster :\n> \`${commande}\`\n\n${lines.join('\n')}`)
  }
}

export const adminCommands: SlashCommand[] = [dinowipeCommand, saveworldCommand, adminchatCommand, adminchatallCommand, rconCommand, rconallCommand]
