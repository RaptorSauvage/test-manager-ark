import type { AutocompleteInteraction, ChatInputCommandInteraction, Client } from 'discord.js'
import type { DiscordBotConfig } from '@shared/discordBot'

export interface CommandContext {
  config: DiscordBotConfig
  client: Client
}

/** Loose enough to accept any of discord.js's SlashCommandBuilder variants (plain, with
 *  subcommands, etc.) without fighting their mutually-incompatible generic types - only
 *  `name` and `toJSON()` are actually used outside of building the command itself. */
export interface SlashCommandData {
  name: string
  toJSON(): unknown
}

export interface SlashCommand {
  data: SlashCommandData
  execute: (interaction: ChatInputCommandInteraction, ctx: CommandContext) => Promise<void>
  autocomplete?: (interaction: AutocompleteInteraction, ctx: CommandContext) => Promise<void>
}
