import { ActivityType, SlashCommandBuilder } from 'discord.js'
import { refreshServerCache, arkServers, minecraftServers, findServerByName } from '../serverCache'
import { refreshStatusMessage, refreshMinecraftStatusMessage, updateBotPresence } from '../statusRefresh'
import {
  getArkMaintenance,
  setArkMaintenance,
  getMcMaintenance,
  setMcMaintenance,
  isCheckDisabled,
  setCheckDisabled,
  isBotMaintenanceMode,
  setBotMaintenanceMode
} from '../maintenanceState'
import { checkMaintenanceWhitelist } from '../permissions'
import { serverNotFoundMessage, autocompleteServerNames } from './helpers'
import type { SlashCommand } from './types'

const maintenanceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription("Gérer le mode maintenance d'un serveur ARK")
    .addSubcommand((sub) =>
      sub
        .setName('on')
        .setDescription('Marque un serveur comme étant en maintenance')
        .addStringOption((opt) => opt.setName('serveur').setDescription('Nom du serveur à mettre en maintenance').setRequired(true).setAutocomplete(true))
        .addStringOption((opt) => opt.setName('raison').setDescription('Raison de la maintenance (optionnel)'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('off')
        .setDescription('Retire un serveur du mode maintenance')
        .addStringOption((opt) => opt.setName('serveur').setDescription('Nom du serveur à sortir du mode maintenance').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('all')
        .setDescription('Active ou désactive la maintenance pour TOUS les serveurs ARK')
        .addStringOption((opt) =>
          opt
            .setName('etat')
            .setDescription('Activer ou désactiver la maintenance sur tout le cluster')
            .setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
        )
        .addStringOption((opt) => opt.setName('raison').setDescription('Raison de la maintenance (optionnel, utilisé seulement si etat=on)'))
    ),
  async execute(interaction, { config, client }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    const sub = interaction.options.getSubcommand()
    await refreshServerCache(config)
    const servers = arkServers()

    if (sub === 'on') {
      const serveur = interaction.options.getString('serveur', true)
      const raison = interaction.options.getString('raison')?.trim() || undefined
      const target = findServerByName(serveur)
      if (!target) {
        await interaction.reply({ content: serverNotFoundMessage(serveur, servers), ephemeral: true })
        return
      }
      setArkMaintenance(target.id, { reason: raison })
      let message = `🔧 Le serveur **${target.name}** est maintenant marqué en maintenance.`
      if (raison) message += `\nRaison : ${raison}`
      await interaction.reply(message)
      await refreshStatusMessage(client, config)
      return
    }

    if (sub === 'off') {
      const serveur = interaction.options.getString('serveur', true)
      const target = findServerByName(serveur)
      if (!target) {
        await interaction.reply({ content: serverNotFoundMessage(serveur, servers), ephemeral: true })
        return
      }
      if (!getArkMaintenance(target.id)) {
        await interaction.reply({ content: `ℹ️ Le serveur **${target.name}** n'était pas en maintenance.`, ephemeral: true })
        return
      }
      setArkMaintenance(target.id, null)
      await interaction.reply(`✅ Le serveur **${target.name}** n'est plus en maintenance.`)
      await refreshStatusMessage(client, config)
      return
    }

    // sub === 'all'
    const etat = interaction.options.getString('etat', true)
    const raison = interaction.options.getString('raison')?.trim() || undefined
    if (etat === 'on') {
      for (const server of servers) setArkMaintenance(server.id, { reason: raison })
      let message = `🔧 **Tout le cluster** (${servers.length} serveur(s)) est maintenant marqué en maintenance.`
      if (raison) message += `\nRaison : ${raison}`
      await interaction.reply(message)
    } else {
      let removedCount = 0
      for (const server of servers) {
        if (getArkMaintenance(server.id)) {
          setArkMaintenance(server.id, null)
          removedCount += 1
        }
      }
      if (removedCount === 0) {
        await interaction.reply({ content: "ℹ️ Aucun serveur n'était en maintenance.", ephemeral: true })
        return
      }
      await interaction.reply(`✅ **${removedCount} serveur(s)** ne sont plus en maintenance.`)
    }
    await refreshStatusMessage(client, config)
  },
  async autocomplete(interaction) {
    const current = interaction.options.getFocused()
    await interaction.respond(await autocompleteServerNames(current, arkServers()))
  }
}

const maintenanceMcCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('maintenancemc')
    .setDescription("Gérer le mode maintenance d'un serveur Minecraft")
    .addSubcommand((sub) =>
      sub
        .setName('on')
        .setDescription('Marque un serveur Minecraft comme étant en maintenance')
        .addStringOption((opt) => opt.setName('serveur').setDescription('Nom du serveur Minecraft à mettre en maintenance').setRequired(true).setAutocomplete(true))
        .addStringOption((opt) => opt.setName('raison').setDescription('Raison de la maintenance (optionnel)'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('off')
        .setDescription('Retire un serveur Minecraft du mode maintenance')
        .addStringOption((opt) => opt.setName('serveur').setDescription('Nom du serveur Minecraft à sortir du mode maintenance').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('all')
        .setDescription('Active ou désactive la maintenance pour TOUS les serveurs Minecraft')
        .addStringOption((opt) =>
          opt
            .setName('etat')
            .setDescription('Activer ou désactiver la maintenance sur tout le cluster')
            .setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
        )
        .addStringOption((opt) => opt.setName('raison').setDescription('Raison de la maintenance (optionnel, utilisé seulement si etat=on)'))
    ),
  async execute(interaction, { config, client }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    const sub = interaction.options.getSubcommand()
    await refreshServerCache(config)
    const servers = minecraftServers()

    if (sub === 'on') {
      const serveur = interaction.options.getString('serveur', true)
      const raison = interaction.options.getString('raison')?.trim() || undefined
      const target = findServerByName(serveur)
      if (!target) {
        await interaction.reply({ content: serverNotFoundMessage(serveur, servers).replace('Serveur', 'Serveur Minecraft'), ephemeral: true })
        return
      }
      setMcMaintenance(target.id, { reason: raison })
      let message = `🔧 Le serveur Minecraft **${target.name}** est maintenant marqué en maintenance.`
      if (raison) message += `\nRaison : ${raison}`
      await interaction.reply(message)
      await refreshMinecraftStatusMessage(client, config)
      return
    }

    if (sub === 'off') {
      const serveur = interaction.options.getString('serveur', true)
      const target = findServerByName(serveur)
      if (!target) {
        await interaction.reply({ content: serverNotFoundMessage(serveur, servers).replace('Serveur', 'Serveur Minecraft'), ephemeral: true })
        return
      }
      if (!getMcMaintenance(target.id)) {
        await interaction.reply({ content: `ℹ️ Le serveur Minecraft **${target.name}** n'était pas en maintenance.`, ephemeral: true })
        return
      }
      setMcMaintenance(target.id, null)
      await interaction.reply(`✅ Le serveur Minecraft **${target.name}** n'est plus en maintenance.`)
      await refreshMinecraftStatusMessage(client, config)
      return
    }

    const etat = interaction.options.getString('etat', true)
    const raison = interaction.options.getString('raison')?.trim() || undefined
    if (etat === 'on') {
      for (const server of servers) setMcMaintenance(server.id, { reason: raison })
      let message = `🔧 **Tout le cluster Minecraft** (${servers.length} serveur(s)) est maintenant marqué en maintenance.`
      if (raison) message += `\nRaison : ${raison}`
      await interaction.reply(message)
    } else {
      let removedCount = 0
      for (const server of servers) {
        if (getMcMaintenance(server.id)) {
          setMcMaintenance(server.id, null)
          removedCount += 1
        }
      }
      if (removedCount === 0) {
        await interaction.reply({ content: "ℹ️ Aucun serveur Minecraft n'était en maintenance.", ephemeral: true })
        return
      }
      await interaction.reply(`✅ **${removedCount} serveur(s) Minecraft** ne sont plus en maintenance.`)
    }
    await refreshMinecraftStatusMessage(client, config)
  },
  async autocomplete(interaction) {
    const current = interaction.options.getFocused()
    await interaction.respond(await autocompleteServerNames(current, minecraftServers()))
  }
}

const botMaintenanceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('botmaintenance')
    .setDescription('Active ou désactive le mode maintenance du bot lui-même')
    .addStringOption((opt) =>
      opt
        .setName('etat')
        .setDescription('Activer ou désactiver le mode maintenance du bot')
        .setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
    ),
  async execute(interaction, { config, client }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    const etat = interaction.options.getString('etat', true)

    if (etat === 'on') {
      setBotMaintenanceMode(true)
      const botName = client.user?.username ?? 'Bot'
      client.user?.setActivity(`${botName} est en maintenance`, { type: ActivityType.Custom })
      await interaction.reply(`🔧 Le bot est maintenant marqué en maintenance (statut : « ${botName} est en maintenance »).`)
      return
    }

    if (!isBotMaintenanceMode()) {
      await interaction.reply({ content: "ℹ️ Le bot n'était pas en maintenance.", ephemeral: true })
      return
    }
    setBotMaintenanceMode(false)
    await interaction.reply('✅ Le bot n\'est plus en maintenance.')

    // Restaure immédiatement le statut normal (nombre de survivants), sans attendre le
    // prochain cycle de rafraîchissement automatique.
    if (config.arkCheckEnabled) {
      await refreshServerCache(config)
      await updateBotPresence(client)
    }
  }
}

const checkCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('check')
    .setDescription("Activer/désactiver le suivi Discord automatique d'un serveur")
    .addSubcommand((sub) =>
      sub
        .setName('off')
        .setDescription('Désactive le suivi automatique pour un serveur')
        .addStringOption((opt) => opt.setName('serveur').setDescription('Serveur pour lequel désactiver le suivi').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('on')
        .setDescription('Réactive le suivi automatique pour un serveur')
        .addStringOption((opt) => opt.setName('serveur').setDescription('Serveur pour lequel réactiver le suivi').setRequired(true).setAutocomplete(true))
    ),
  async execute(interaction, { config, client }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    const sub = interaction.options.getSubcommand()
    const serveur = interaction.options.getString('serveur', true)
    await refreshServerCache(config)
    const servers = [...arkServers(), ...minecraftServers()]
    const target = findServerByName(serveur)
    if (!target) {
      await interaction.reply({ content: serverNotFoundMessage(serveur, servers), ephemeral: true })
      return
    }

    if (sub === 'off') {
      if (isCheckDisabled(target.id)) {
        await interaction.reply({ content: `ℹ️ Le suivi de **${target.name}** était déjà désactivé.`, ephemeral: true })
        return
      }
      setCheckDisabled(target.id, true)
      await interaction.reply(`⚫ Suivi Discord désactivé pour **${target.name}**.`)
    } else {
      if (!isCheckDisabled(target.id)) {
        await interaction.reply({ content: `ℹ️ Le suivi de **${target.name}** était déjà actif.`, ephemeral: true })
        return
      }
      setCheckDisabled(target.id, false)
      await interaction.reply(`✅ Suivi Discord réactivé pour **${target.name}**.`)
    }
    await refreshStatusMessage(client, config)
    await refreshMinecraftStatusMessage(client, config)
  },
  async autocomplete(interaction) {
    const current = interaction.options.getFocused()
    await interaction.respond(await autocompleteServerNames(current, [...arkServers(), ...minecraftServers()]))
  }
}

export const maintenanceCommands: SlashCommand[] = [maintenanceCommand, maintenanceMcCommand, botMaintenanceCommand, checkCommand]
