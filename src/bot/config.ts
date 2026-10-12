import fs from 'node:fs'
import type { DiscordBotConfig } from '@shared/discordBot'
import { log } from './logging'

/** Reads the config file path the main process passes as the first CLI argument (see
 *  discordBot.ts's own supervisor) - a file rather than an env var or an IPC message so the
 *  bot can always re-read its own current config on a restart without depending on the
 *  parent being there to resend it. Exits the process on any failure: there's no sensible
 *  partial-config fallback for a bot that hasn't even connected to Discord yet. */
export function loadConfig(): DiscordBotConfig {
  const configPath = process.argv[2]
  if (!configPath) {
    log.error('Aucun fichier de configuration fourni (argument manquant).')
    process.exit(1)
  }

  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf-8')
  } catch (err) {
    log.error(`Impossible de lire le fichier de configuration ${configPath} : ${(err as Error).message}`)
    process.exit(1)
  }

  let config: DiscordBotConfig
  try {
    config = JSON.parse(raw) as DiscordBotConfig
  } catch (err) {
    log.error(`Fichier de configuration invalide (JSON malformé) : ${(err as Error).message}`)
    process.exit(1)
  }

  if (!config.discordToken) {
    log.error('discordToken manquant dans la configuration.')
    process.exit(1)
  }

  return config
}
