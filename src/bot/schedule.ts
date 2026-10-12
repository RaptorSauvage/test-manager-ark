import type { Client } from 'discord.js'
import type { DiscordBotConfig } from '@shared/discordBot'
import { parseScheduleTime } from '@shared/scheduleTime'
import { findServerByName } from './serverCache'
import { sendManagerRconCommand } from './managerApiClient'
import { log } from './logging'

/** In-memory only, not persisted - a bot restart clears every scheduled DinoWipe, same as
 *  the standalone bot (see its README's "planifications gardées en mémoire seulement"). The
 *  configured hour/minute is the machine's own local time, not a Discord-side timezone. */
export interface ScheduledDinowipe {
  id: string
  serverName: string
  hour: number
  minute: number
  repeat: boolean
  createdBy: string
  /** ISO date (YYYY-MM-DD) of the last run, to avoid firing twice inside the same minute. */
  lastRunDate?: string
}

const scheduled = new Map<string, ScheduledDinowipe>()
let nextId = 0

export function nextScheduleId(): string {
  nextId += 1
  return String(nextId)
}

export function addSchedule(entry: ScheduledDinowipe): void {
  scheduled.set(entry.id, entry)
}

export function removeSchedule(id: string): ScheduledDinowipe | undefined {
  const entry = scheduled.get(id)
  scheduled.delete(id)
  return entry
}

export function allSchedules(): ScheduledDinowipe[] {
  return [...scheduled.values()].sort((a, b) => Number(a.id) - Number(b.id))
}

/** Parses "HH:MM" the same way `/schedule dinowipe` presents it - reuses the Manager's own
 *  shared/scheduleTime.ts parser (same format, already covered by its own tests) instead of
 *  a second regex. */
export function parseScheduleHour(time: string): { hour: number; minute: number } | null {
  return parseScheduleTime(time.trim())
}

async function runScheduledDinowipe(client: Client, config: DiscordBotConfig, scheduleId: string, entry: ScheduledDinowipe): Promise<void> {
  const server = findServerByName(entry.serverName)
  if (!server) {
    log.warn(
      `Planification DinoWipe id=${scheduleId} ignorée : serveur '${entry.serverName}' introuvable (supprimé de la config ?)`
    )
    return
  }

  let success = false
  let output = ''
  try {
    const result = await sendManagerRconCommand(config, server.id, 'DestroyWildDinos')
    success = result.ok
    output = result.ok ? result.response ?? '' : result.error ?? ''
  } catch (err) {
    output = (err as Error).message
  }
  log.info(`DinoWipe planifié (id=${scheduleId}) exécuté sur '${server.name}' (succès=${success})`)

  if (config.statusChannelId) {
    const channel = client.channels.cache.get(config.statusChannelId)
    if (channel && 'send' in channel) {
      const icon = success ? '🦖' : '❌'
      const text = success ? 'Exécuté avec succès.' : `Échec : ${output}`
      try {
        await channel.send(`${icon} DinoWipe planifié sur **${server.name}** — ${text}`)
      } catch {
        log.warn(`Impossible de notifier le DinoWipe planifié dans statusChannelId=${config.statusChannelId} (permissions manquantes).`)
      }
    }
  }
}

/** Appelée toutes les 30s (voir index.ts) - déclenche chaque planification dont l'heure
 *  correspond à maintenant, une fois par fenêtre d'une minute. */
export async function checkSchedules(client: Client, config: DiscordBotConfig): Promise<void> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  for (const [scheduleId, entry] of [...scheduled.entries()]) {
    if (entry.hour !== now.getHours() || entry.minute !== now.getMinutes()) continue
    if (entry.lastRunDate === today) continue

    entry.lastRunDate = today
    await runScheduledDinowipe(client, config, scheduleId, entry)

    if (!entry.repeat) scheduled.delete(scheduleId)
  }
}
