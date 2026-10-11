import { SlashCommandBuilder } from 'discord.js'
import { refreshServerCache, arkServers, minecraftServers, findServerByName } from '../serverCache'
import {
  queryEosStatus,
  queryOfficialNetworkStatus,
  queryAwsStatus,
  queryXboxStatus,
  queryCloudflareStatus,
  queryMinecraftAuthStatus
} from '../externalStatus'
import { buildStatusEmbed, buildMinecraftStatusEmbed, buildServerDetailEmbed } from '../statusEmbeds'
import { getArkMaintenance, isCheckDisabled } from '../maintenanceState'
import { serverNotFoundMessage, autocompleteServerNames } from './helpers'
import type { SlashCommand } from './types'

const statusCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName('status').setDescription('Affiche le statut de tout le cluster ARK: Survival Ascended'),
  async execute(interaction, { config }) {
    await interaction.deferReply()

    if (!config.arkCheckEnabled) {
      await interaction.followUp('⚠️ Le check ARK est actuellement désactivé (arkCheckEnabled=false).')
      return
    }

    const [servers, eos, official, aws, cloudflare] = await Promise.all([
      refreshServerCache(config),
      queryEosStatus(),
      queryOfficialNetworkStatus(),
      queryAwsStatus(),
      queryCloudflareStatus()
    ])

    const embed = buildStatusEmbed(arkServers(servers), [eos[0], aws[0], cloudflare[0], official[0]], config)
    await interaction.followUp({ embeds: [embed] })
  }
}

const statusServeurCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('statusserveur')
    .setDescription('Affiche le statut détaillé d\'un serveur (joueurs et liste) dans un message séparé')
    .addStringOption((opt) => opt.setName('serveur').setDescription('Nom du serveur à consulter').setRequired(true).setAutocomplete(true)),
  async execute(interaction, { config }) {
    await interaction.deferReply()
    const serveur = interaction.options.getString('serveur', true)
    await refreshServerCache(config)
    const target = findServerByName(serveur)
    if (!target) {
      await interaction.followUp(serverNotFoundMessage(serveur, arkServers()))
      return
    }
    const embed = buildServerDetailEmbed(target, getArkMaintenance(target.id), isCheckDisabled(target.id))
    await interaction.followUp({ embeds: [embed] })
  },
  async autocomplete(interaction) {
    const current = interaction.options.getFocused()
    await interaction.respond(await autocompleteServerNames(current, arkServers()))
  }
}

const statusMcCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName('statusmc').setDescription('Affiche le statut de tout le cluster Minecraft'),
  async execute(interaction, { config }) {
    await interaction.deferReply()

    if (!config.mcCheckEnabled) {
      await interaction.followUp('⚠️ Le check Minecraft est actuellement désactivé (mcCheckEnabled=false).')
      return
    }

    const servers = await refreshServerCache(config)
    const mcServers = minecraftServers(servers)
    if (mcServers.length === 0) {
      await interaction.followUp("⚠️ Aucun serveur Minecraft n'est configuré.")
      return
    }

    const [xbox, cloudflare, aws, mcAuth] = await Promise.all([
      queryXboxStatus(),
      queryCloudflareStatus(),
      queryAwsStatus(),
      queryMinecraftAuthStatus()
    ])

    const embed = buildMinecraftStatusEmbed(mcServers, [xbox[0], cloudflare[0], aws[0], mcAuth[0]], config)
    await interaction.followUp({ embeds: [embed] })
  }
}

// Partagée avec statusserveur pour les commandes Minecraft (maintenance/schedule/check) -
// même logique d'autocomplétion, juste filtrée sur les serveurs Minecraft.
export async function mcAutocomplete(current: string): Promise<{ name: string; value: string }[]> {
  return autocompleteServerNames(current, minecraftServers())
}

export function arkAutocomplete(current: string): Promise<{ name: string; value: string }[]> {
  return autocompleteServerNames(current, arkServers())
}

export const statusCommands: SlashCommand[] = [statusCommand, statusServeurCommand, statusMcCommand]
