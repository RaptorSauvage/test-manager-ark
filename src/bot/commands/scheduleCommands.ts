import { SlashCommandBuilder } from 'discord.js'
import { refreshServerCache, arkServers, findServerByName } from '../serverCache'
import { addSchedule, allSchedules, nextScheduleId, parseScheduleHour, removeSchedule } from '../schedule'
import { checkMaintenanceWhitelist } from '../permissions'
import { serverNotFoundMessage, autocompleteServerNames } from './helpers'
import type { SlashCommand } from './types'

const scheduleCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Planifier des tâches automatiques (ex: DinoWipe)')
    .addSubcommand((sub) =>
      sub
        .setName('dinowipe')
        .setDescription("Planifie l'exécution de DestroyWildDinos à une heure donnée")
        .addStringOption((opt) => opt.setName('serveur').setDescription('Serveur concerné').setRequired(true).setAutocomplete(true))
        .addStringOption((opt) =>
          opt.setName('heure').setDescription('Heure au format HH:MM (heure de la machine qui fait tourner le bot)').setRequired(true)
        )
        .addBooleanOption((opt) =>
          opt.setName('repeter').setDescription('Si activé, se répète chaque jour à cette heure (sinon, une seule exécution)')
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Liste les DinoWipe planifiés'))
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Annule un DinoWipe planifié')
        .addStringOption((opt) => opt.setName('id').setDescription('ID de la planification à annuler (voir /schedule list)').setRequired(true))
    ),
  async execute(interaction, { config }) {
    if (!(await checkMaintenanceWhitelist(interaction, config))) return
    const sub = interaction.options.getSubcommand()

    if (sub === 'dinowipe') {
      const serveur = interaction.options.getString('serveur', true)
      const heure = interaction.options.getString('heure', true)
      const repeter = interaction.options.getBoolean('repeter') ?? false

      await refreshServerCache(config)
      const target = findServerByName(serveur)
      if (!target) {
        await interaction.reply({ content: serverNotFoundMessage(serveur, arkServers()), ephemeral: true })
        return
      }

      const parsed = parseScheduleHour(heure)
      if (!parsed) {
        await interaction.reply({ content: "⚠️ Format d'heure invalide. Utilise HH:MM (ex: `03:00`).", ephemeral: true })
        return
      }

      const scheduleId = nextScheduleId()
      addSchedule({
        id: scheduleId,
        serverName: target.name,
        hour: parsed.hour,
        minute: parsed.minute,
        repeat: repeter,
        createdBy: interaction.user.tag
      })

      const repeatStr = repeter ? 'tous les jours' : 'une seule fois'
      const hourLabel = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`
      await interaction.reply(
        `⏰ DinoWipe planifié sur **${target.name}** à **${hourLabel}** (${repeatStr}).\n` +
          `ID de la planification : \`${scheduleId}\` (utilise \`/schedule cancel\` pour l'annuler)`
      )
      return
    }

    if (sub === 'list') {
      const entries = allSchedules()
      if (entries.length === 0) {
        await interaction.reply({ content: 'Aucun DinoWipe planifié pour le moment.', ephemeral: true })
        return
      }
      const lines = entries.map((s) => {
        const repeatStr = s.repeat ? '🔁 tous les jours' : '1 seule fois'
        const hourLabel = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
        return `\`${s.id}\` — **${s.serverName}** à **${hourLabel}** (${repeatStr})`
      })
      await interaction.reply(`⏰ **DinoWipe planifiés :**\n${lines.join('\n')}`)
      return
    }

    // sub === 'cancel'
    const id = interaction.options.getString('id', true)
    const removed = removeSchedule(id)
    if (!removed) {
      await interaction.reply({ content: `⚠️ Aucune planification avec l'ID \`${id}\`. Utilise \`/schedule list\` pour voir les IDs actifs.`, ephemeral: true })
      return
    }
    const hourLabel = `${String(removed.hour).padStart(2, '0')}:${String(removed.minute).padStart(2, '0')}`
    await interaction.reply(`🗑️ Planification \`${id}\` annulée (${removed.serverName} à ${hourLabel}).`)
  },
  async autocomplete(interaction) {
    const current = interaction.options.getFocused()
    await interaction.respond(await autocompleteServerNames(current, arkServers()))
  }
}

export const scheduleCommands: SlashCommand[] = [scheduleCommand]
