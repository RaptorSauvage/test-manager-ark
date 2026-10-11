import type { ChatInputCommandInteraction } from 'discord.js'
import type { DiscordBotConfig } from '@shared/discordBot'

export function isMaintenanceWhitelisted(interaction: ChatInputCommandInteraction, config: DiscordBotConfig): boolean {
  return config.maintenanceWhitelistIds.includes(interaction.user.id)
}

/** Port of the standalone bot's `_check_maintenance_whitelist` - sends the refusal itself and
 *  returns false so every command handler can `if (!(await checkMaintenanceWhitelist(...))) return`. */
export async function checkMaintenanceWhitelist(interaction: ChatInputCommandInteraction, config: DiscordBotConfig): Promise<boolean> {
  if (isMaintenanceWhitelisted(interaction, config)) return true
  await interaction.reply({ content: "⛔ Tu n'es pas autorisé à utiliser cette commande.", ephemeral: true })
  return false
}

export function isManagerWhitelisted(interaction: ChatInputCommandInteraction, config: DiscordBotConfig): boolean {
  return config.managerWhitelistIds.includes(interaction.user.id) || config.maintenanceWhitelistIds.includes(interaction.user.id)
}

export async function checkManagerWhitelist(interaction: ChatInputCommandInteraction, config: DiscordBotConfig): Promise<boolean> {
  if (isManagerWhitelisted(interaction, config)) return true
  await interaction.reply({ content: "⛔ Tu n'es pas autorisé à utiliser cette commande.", ephemeral: true })
  return false
}
