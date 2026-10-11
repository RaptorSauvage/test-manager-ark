import type { Client, TextChannel } from 'discord.js'
import type { DiscordBotConfig } from '@shared/discordBot'
import {
  allGuildIdsWithChannel,
  buildCurseforgeEmbed,
  curseforgeHtmlToText,
  curseforgeSplitChangelog,
  fetchChangelog,
  fetchModData,
  getGuildChannelId,
  getGuildMods,
  latestFileOf,
  loadState,
  saveState,
  type CurseforgeModData
} from './curseforge'
import { log } from './logging'

/** Port de `curseforge_check_for_updates` - appelée périodiquement (voir index.ts), toutes
 *  les `config.curseforge.checkIntervalMinutes` minutes. Au premier passage sur un mod,
 *  enregistre juste sa version actuelle comme référence (pas de notification) - seules les
 *  mises à jour suivantes déclenchent une notification. */
export async function checkCurseforgeUpdates(client: Client, config: DiscordBotConfig): Promise<void> {
  const guildIdsWithChannel = allGuildIdsWithChannel(config)
  if (guildIdsWithChannel.length === 0) return // aucun serveur n'a encore configuré /setchannel

  const state = loadState(config)
  const modDataCache = new Map<string, CurseforgeModData | null>()
  const changelogCache = new Map<string, string>()

  for (const guildId of guildIdsWithChannel) {
    const channelId = getGuildChannelId(config, guildId)
    const channel = channelId ? client.channels.cache.get(channelId) : undefined
    if (!channel || !('send' in channel)) {
      log.error(`Salon CurseForge introuvable (id=${channelId}, serveur=${guildId}). Retape /setchannel si besoin.`)
      continue
    }

    const guildMods = getGuildMods(config, guildId)
    if (guildMods.length === 0) continue

    const guildState = (state[guildId] = state[guildId] ?? {})

    for (const modId of guildMods) {
      if (!modDataCache.has(modId)) {
        modDataCache.set(modId, await fetchModData(config.curseforge.apiKey, modId))
      }
      const modData = modDataCache.get(modId)
      if (!modData) continue

      const latestFile = latestFileOf(modData)
      if (!latestFile) {
        log.warn(`Aucun fichier trouvé pour le mod CurseForge ${modId}.`)
        continue
      }

      const lastKnown = guildState[modId]
      if (lastKnown === undefined) {
        // Premier suivi de ce mod pour ce serveur : baseline sans notifier
        guildState[modId] = latestFile.id
        continue
      }

      if (latestFile.id !== lastKnown) {
        log.info(`[CurseForge][serveur ${guildId}][${modId}] Nouvelle version détectée (${lastKnown} -> ${latestFile.id})`)
        const cacheKey = `${modId}:${latestFile.id}`
        if (!changelogCache.has(cacheKey)) {
          const changelogData = await fetchChangelog(config.curseforge.apiKey, modId, latestFile.id)
          changelogCache.set(cacheKey, curseforgeHtmlToText(changelogData))
        }
        const changelogText = changelogCache.get(cacheKey) ?? ''

        const parts = curseforgeSplitChangelog(changelogText)
        for (let i = 0; i < parts.length; i++) {
          const embed = buildCurseforgeEmbed(modData, latestFile, parts[i], false)
          if (parts.length > 1) embed.setTitle(`${embed.data.title} — partie ${i + 1}/${parts.length}`)
          try {
            await (channel as TextChannel).send({ embeds: [embed] })
          } catch {
            log.error(`Permissions insuffisantes pour poster dans le salon CurseForge ${channel.id}.`)
            break // inutile de tenter les parties suivantes
          }
        }
        guildState[modId] = latestFile.id
      }
    }
  }

  saveState(config, state)
}
