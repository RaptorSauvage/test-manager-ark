import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import {
  addGuildMod,
  buildCurseforgeEmbed,
  curseforgeHtmlToText,
  curseforgeSplitChangelog,
  fetchChangelog,
  fetchModData,
  getGuildMods,
  latestFileOf,
  removeGuildMod,
  setNotificationChannelId
} from '../curseforge'
import { checkMaintenanceWhitelist } from '../permissions'
import type { SlashCommand } from './types'

function curseforgeDisabledMessage(): string {
  return "⚠️ Le module CurseForge n'est pas activé (vérifie la clé API CurseForge dans Settings)."
}

const setchannelCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Définit le salon où seront postées les notifications de mise à jour de mods')
    .addChannelOption((opt) =>
      opt.setName('salon').setDescription('Le salon à utiliser (par défaut, le salon actuel)').addChannelTypes(ChannelType.GuildText)
    ),
  async execute(interaction, { config }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    if (!config.curseforge.moduleEnabled || !config.curseforge.apiKey) {
      await interaction.reply({ content: curseforgeDisabledMessage(), ephemeral: true })
      return
    }
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: 'Cette commande ne peut être utilisée que sur un serveur Discord.', ephemeral: true })
      return
    }

    const targetChannelOption = interaction.options.getChannel('salon') ?? interaction.channel
    // getChannel() only returns the resolved interaction payload's (sometimes partial) data -
    // re-fetched from the guild's own channel cache here to get a real TextChannel with
    // `permissionsFor`/`send`, same as the guild's own `interaction.channel` already is.
    const targetChannel = targetChannelOption ? interaction.guild.channels.cache.get(targetChannelOption.id) : undefined
    if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: '⚠️ Choisis un salon textuel.', ephemeral: true })
      return
    }

    const me = interaction.guild.members.me
    const perms = me ? targetChannel.permissionsFor(me) : null
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.EmbedLinks)) {
      await interaction.reply({
        content: `⚠️ Permissions insuffisantes (\`Envoyer des messages\` / \`Intégrer des liens\`) dans ${targetChannel.toString()}. Corrige les permissions et réessaie.`,
        ephemeral: true
      })
      return
    }

    setNotificationChannelId(config, interaction.guildId, targetChannel.id)
    await interaction.reply(`✅ Les notifications de mise à jour pour **ce serveur** seront postées dans ${targetChannel.toString()}.`)
  }
}

const addmodCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('addmod')
    .setDescription('Ajoute un mod CurseForge à suivre sur ce serveur')
    .addStringOption((opt) => opt.setName('mod_id').setDescription("ID du mod CurseForge (trouvable dans 'About Project' sur la page du mod)").setRequired(true)),
  async execute(interaction, { config }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    if (!config.curseforge.moduleEnabled || !config.curseforge.apiKey) {
      await interaction.reply({ content: curseforgeDisabledMessage(), ephemeral: true })
      return
    }
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Cette commande ne peut être utilisée que sur un serveur Discord.', ephemeral: true })
      return
    }

    const modId = interaction.options.getString('mod_id', true).trim()
    await interaction.deferReply({ ephemeral: true })

    const modData = await fetchModData(config.curseforge.apiKey, modId)
    if (!modData) {
      await interaction.followUp(`❌ Mod \`${modId}\` introuvable sur CurseForge. Vérifie l'ID et réessaie.`)
      return
    }

    const added = addGuildMod(config, interaction.guildId, modId)
    const modName = modData.name ?? modId
    if (added) {
      await interaction.followUp(`✅ **${modName}** (\`${modId}\`) est maintenant suivi sur ce serveur.`)
    } else {
      await interaction.followUp(`ℹ️ **${modName}** (\`${modId}\`) était déjà suivi sur ce serveur.`)
    }
  }
}

const removemodCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('removemod')
    .setDescription('Retire un mod CurseForge de la liste suivie sur ce serveur')
    .addStringOption((opt) => opt.setName('mod_id').setDescription('ID du mod à retirer (voir /listmods)').setRequired(true)),
  async execute(interaction, { config }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    if (!config.curseforge.moduleEnabled || !config.curseforge.apiKey) {
      await interaction.reply({ content: curseforgeDisabledMessage(), ephemeral: true })
      return
    }
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Cette commande ne peut être utilisée que sur un serveur Discord.', ephemeral: true })
      return
    }

    const modId = interaction.options.getString('mod_id', true).trim()
    const removed = removeGuildMod(config, interaction.guildId, modId)
    if (removed) {
      await interaction.reply(`✅ Le mod \`${modId}\` ne sera plus suivi sur ce serveur.`)
    } else {
      await interaction.reply({
        content: `ℹ️ Le mod \`${modId}\` n'était pas suivi sur ce serveur. Utilise \`/listmods\` pour voir la liste actuelle.`,
        ephemeral: true
      })
    }
  }
}

const listmodsCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName('listmods').setDescription('Affiche les mods CurseForge actuellement suivis sur ce serveur'),
  async execute(interaction, { config }) {
    if (!config.curseforge.moduleEnabled || !config.curseforge.apiKey) {
      await interaction.reply({ content: curseforgeDisabledMessage(), ephemeral: true })
      return
    }
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Cette commande ne peut être utilisée que sur un serveur Discord.', ephemeral: true })
      return
    }

    const modIds = getGuildMods(config, interaction.guildId)
    if (modIds.length === 0) {
      await interaction.reply({ content: 'Aucun mod suivi sur ce serveur pour l\'instant. Utilise `/addmod` pour en ajouter un.', ephemeral: true })
      return
    }

    await interaction.deferReply()
    const lines: string[] = []
    for (const modId of modIds) {
      const modData = await fetchModData(config.curseforge.apiKey, modId)
      const name = modData ? modData.name ?? 'Nom inconnu' : '⚠️ introuvable'
      lines.push(`• **${name}** — \`${modId}\``)
    }

    await interaction.followUp({
      embeds: [
        {
          title: 'Mods suivis sur ce serveur',
          description: lines.join('\n'),
          color: 0x3498db
        }
      ]
    })
  }
}

const testmodCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('testmod')
    .setDescription("Prévisualise une notification de mise à jour CurseForge (n'envoie rien)")
    .addStringOption((opt) => opt.setName('mod_id').setDescription('ID du mod à tester (par défaut, le premier mod suivi sur ce serveur)')),
  async execute(interaction, { config }) {
    if (!config.curseforge.moduleEnabled || !config.curseforge.apiKey) {
      await interaction.reply({ content: curseforgeDisabledMessage(), ephemeral: true })
      return
    }

    await interaction.deferReply()

    const modIdOption = interaction.options.getString('mod_id')?.trim()
    const targetModId =
      modIdOption || (interaction.guildId ? getGuildMods(config, interaction.guildId)[0] : config.curseforge.defaultModIds[0])

    if (!targetModId) {
      await interaction.followUp('Aucun mod configuré sur ce serveur. Utilise `/addmod` ou précise un paramètre `mod_id`.')
      return
    }

    const modData = await fetchModData(config.curseforge.apiKey, targetModId)
    if (!modData) {
      await interaction.followUp(`Impossible de récupérer les infos du mod \`${targetModId}\`. Vérifie l'ID et la clé API.`)
      return
    }

    const latestFile = latestFileOf(modData)
    if (!latestFile) {
      await interaction.followUp(`Aucun fichier trouvé pour le mod \`${targetModId}\`.`)
      return
    }

    const changelogData = await fetchChangelog(config.curseforge.apiKey, targetModId, latestFile.id)
    const changelogText = curseforgeHtmlToText(changelogData)
    const parts = curseforgeSplitChangelog(changelogText)

    for (let i = 0; i < parts.length; i++) {
      const embed = buildCurseforgeEmbed(modData, latestFile, parts[i], true)
      if (parts.length > 1) embed.setTitle(`${embed.data.title} — partie ${i + 1}/${parts.length}`)
      await interaction.followUp({ embeds: [embed] })
    }
  }
}

export const curseforgeCommands: SlashCommand[] = [setchannelCommand, addmodCommand, removemodCommand, listmodsCommand, testmodCommand]
