import fs from 'node:fs'
import path from 'node:path'
import { EmbedBuilder } from 'discord.js'
import type { DiscordBotConfig } from '@shared/discordBot'
import { log } from './logging'

/** Convertit le changelog HTML renvoyé par CurseForge en Markdown compatible Discord (gras,
 *  italique, liens, code, listes, etc.), au lieu de simplement supprimer les balises - port
 *  1:1 de curseforge_html_to_text du bot standalone. */
export function curseforgeHtmlToText(rawHtml: string | null | undefined): string {
  if (!rawHtml) return '*(Aucun changelog fourni pour ce fichier)*'

  let text = rawHtml

  // Liens : <a href="url">texte</a> -> [texte](url)
  text = text.replace(/<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')

  // Gras : <strong>/<b> -> **texte**
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')

  // Italique : <em>/<i> -> *texte*
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')

  // Souligné : <u> -> __texte__
  text = text.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '__$1__')

  // Barré : <s>/<strike>/<del> -> ~~texte~~
  text = text.replace(/<(s|strike|del)[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~')

  // Code : <code> -> `texte` (inline), <pre> -> bloc de code
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```')
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')

  // Titres : <h1>-<h6> -> **texte** sur sa propre ligne (Discord n'a pas de vrais titres)
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n**$1**\n')

  // Listes : <li> -> puce, </li>/<br> -> saut de ligne, <p>/<div> -> saut de ligne
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/li>/gi, '\n')
  text = text.replace(/<li[^>]*>/gi, '• ')
  text = text.replace(/<\/(p|div)>/gi, '\n\n')
  text = text.replace(/<(p|div)[^>]*>/gi, '')
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n')

  // Retire toutes les balises restantes (ul/ol/span/etc., purement structurelles)
  text = text.replace(/<[^>]+>/g, '')

  text = decodeHtmlEntities(text)
  text = text.replace(/\n{3,}/g, '\n\n').trim()

  return text || '*(Changelog vide)*'
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
}

/** Découpe un changelog trop long pour tenir dans un seul embed Discord (limite ~4096
 *  caractères) en plusieurs morceaux, au lieu de le tronquer - coupe sur des retours à la
 *  ligne autant que possible pour rester lisible. Port 1:1 de curseforge_split_changelog. */
export function curseforgeSplitChangelog(text: string, chunkSize = 3900): string[] {
  if (text.length <= chunkSize) return [text]

  const chunks: string[] = []
  let current = ''
  for (let line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line
    if (candidate.length > chunkSize) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      // Une seule ligne qui dépasse déjà la limite à elle seule : découpe brute.
      while (line.length > chunkSize) {
        chunks.push(line.slice(0, chunkSize))
        line = line.slice(chunkSize)
      }
      current = line
    } else {
      current = candidate
    }
  }
  if (current) chunks.push(current)
  return chunks
}

// ---------------------------------------------------------------------------
// Persistance (deux fichiers JSON dans config.stateDir, survivent aux redémarrages - voir
// le README pour le format, identique au bot standalone).
// ---------------------------------------------------------------------------
interface CurseforgeGuildConfig {
  channels?: Record<string, string>
  mods?: Record<string, string[]>
}

type CurseforgeState = Record<string, Record<string, number>>

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch (err) {
    log.warn(`Impossible de lire ${filePath} (${(err as Error).message}), utilisation des valeurs par défaut.`)
    return fallback
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8')
  } catch (err) {
    log.error(`Impossible d'écrire ${filePath} : ${(err as Error).message}`)
  }
}

function configFile(config: DiscordBotConfig): string {
  return path.join(config.stateDir, 'curseforge_config.json')
}

function stateFile(config: DiscordBotConfig): string {
  return path.join(config.stateDir, 'curseforge_last_known.json')
}

function loadGuildConfig(config: DiscordBotConfig): CurseforgeGuildConfig {
  return readJsonFile(configFile(config), {})
}

function saveGuildConfig(config: DiscordBotConfig, guildConfig: CurseforgeGuildConfig): void {
  writeJsonFile(configFile(config), guildConfig)
}

export function loadState(config: DiscordBotConfig): CurseforgeState {
  return readJsonFile(stateFile(config), {})
}

export function saveState(config: DiscordBotConfig, state: CurseforgeState): void {
  writeJsonFile(stateFile(config), state)
}

/** Retourne le salon de notification configuré pour CE serveur Discord, ou undefined. */
export function getNotificationChannelId(config: DiscordBotConfig, guildId: string): string | undefined {
  return loadGuildConfig(config).channels?.[guildId]
}

/** Enregistre le salon de notification pour CE serveur Discord (indépendant des autres). */
export function setNotificationChannelId(config: DiscordBotConfig, guildId: string, channelId: string): void {
  const guildConfig = loadGuildConfig(config)
  guildConfig.channels = guildConfig.channels ?? {}
  guildConfig.channels[guildId] = channelId
  saveGuildConfig(config, guildConfig)
}

export function allGuildIdsWithChannel(config: DiscordBotConfig): string[] {
  return Object.keys(loadGuildConfig(config).channels ?? {})
}

export function getGuildChannelId(config: DiscordBotConfig, guildId: string): string | undefined {
  return loadGuildConfig(config).channels?.[guildId]
}

/** Retourne la liste des mod_id suivis par CE serveur Discord - retombe sur
 *  `config.curseforge.defaultModIds` si le serveur n'a encore rien configuré via /addmod. */
export function getGuildMods(config: DiscordBotConfig, guildId: string): string[] {
  const guildMods = loadGuildConfig(config).mods?.[guildId]
  return guildMods && guildMods.length > 0 ? guildMods : config.curseforge.defaultModIds
}

/** Ajoute un mod à la liste suivie par CE serveur Discord. False si déjà présent. */
export function addGuildMod(config: DiscordBotConfig, guildId: string, modId: string): boolean {
  const guildConfig = loadGuildConfig(config)
  guildConfig.mods = guildConfig.mods ?? {}
  const current = (guildConfig.mods[guildId] = guildConfig.mods[guildId] ?? [...config.curseforge.defaultModIds])
  if (current.includes(modId)) return false
  current.push(modId)
  saveGuildConfig(config, guildConfig)
  return true
}

/** Retire un mod de la liste suivie par CE serveur Discord. False s'il n'y était pas. */
export function removeGuildMod(config: DiscordBotConfig, guildId: string, modId: string): boolean {
  const guildConfig = loadGuildConfig(config)
  guildConfig.mods = guildConfig.mods ?? {}
  const current = (guildConfig.mods[guildId] = guildConfig.mods[guildId] ?? [...config.curseforge.defaultModIds])
  const index = current.indexOf(modId)
  if (index === -1) return false
  current.splice(index, 1)
  saveGuildConfig(config, guildConfig)
  return true
}

// ---------------------------------------------------------------------------
// Appels à l'API CurseForge
// ---------------------------------------------------------------------------
export interface CurseforgeModFile {
  id: number
  displayName?: string
  fileName?: string
  fileDate?: string
}

export interface CurseforgeModData {
  name?: string
  links?: { websiteUrl?: string }
  logo?: { thumbnailUrl?: string | null } | null
  latestFiles?: CurseforgeModFile[]
}

export async function fetchModData(apiKey: string, modId: string): Promise<CurseforgeModData | null> {
  const response = await fetch(`https://api.curseforge.com/v1/mods/${encodeURIComponent(modId)}`, {
    headers: { 'x-api-key': apiKey, Accept: 'application/json' }
  })
  if (!response.ok) {
    log.error(`Erreur API CurseForge pour le mod ${modId} (${response.status}) : ${await response.text()}`)
    return null
  }
  const data = (await response.json()) as { data?: CurseforgeModData }
  return data.data ?? null
}

export async function fetchChangelog(apiKey: string, modId: string, fileId: number): Promise<string | null> {
  const response = await fetch(
    `https://api.curseforge.com/v1/mods/${encodeURIComponent(modId)}/files/${fileId}/changelog`,
    { headers: { 'x-api-key': apiKey, Accept: 'application/json' } }
  )
  if (!response.ok) {
    log.error(`Erreur API changelog pour le mod ${modId} (${response.status}) : ${await response.text()}`)
    return null
  }
  const data = (await response.json()) as { data?: string }
  return data.data ?? null
}

/** Extrait le numéro de version du nom du fichier - priorité au chiffre précédé d'un 'v'
 *  (ex: 'Mod_v99.zip' -> '99'), sinon le DERNIER nombre du nom (souvent la version,
 *  contrairement au premier qui peut être une date ou un ID de mod). */
export function extractVersion(displayName: string | undefined, fileName: string | undefined): string {
  const text = displayName || fileName || ''
  const vMatch = /[vV](\d+)/.exec(text)
  if (vMatch) return vMatch[1]
  const allNumbers = text.match(/\d+/g)
  if (allNumbers && allNumbers.length > 0) return allNumbers[allNumbers.length - 1]
  return displayName || fileName || 'N/A'
}

export function latestFileOf(modData: CurseforgeModData): CurseforgeModFile | null {
  const files = modData.latestFiles ?? []
  if (files.length === 0) return null
  return files.reduce((a, b) => ((b.fileDate ?? '') > (a.fileDate ?? '') ? b : a))
}

export function buildCurseforgeEmbed(
  modData: CurseforgeModData,
  latestFile: CurseforgeModFile,
  changelogText: string | undefined,
  isTest: boolean
): EmbedBuilder {
  const modName = modData.name ?? 'Mod inconnu'
  const version = extractVersion(latestFile.displayName, latestFile.fileName)

  const embed = new EmbedBuilder()
    .setTitle(`${modName} - v${version}`)
    .setDescription(changelogText || '*(Aucun changelog fourni pour ce fichier)*')
    .setColor(isTest ? 0xf1c40f : 0x3498db)

  if (modData.links?.websiteUrl) embed.setURL(modData.links.websiteUrl)
  if (latestFile.fileDate) {
    const date = new Date(latestFile.fileDate)
    if (!Number.isNaN(date.getTime())) embed.setTimestamp(date)
  }
  if (modData.logo?.thumbnailUrl) embed.setThumbnail(modData.logo.thumbnailUrl)
  return embed
}
