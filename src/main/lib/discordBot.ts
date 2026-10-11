import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AppSettings } from '@shared/types'
import type { DiscordBotConfig } from '@shared/discordBot'
import { getSettings, saveSettings, saveWebDashboardApiKey, deleteWebDashboardApiKey } from '../store'
import { hashPassword, generateApiKeyId, generateApiKeySecret, buildApiKey } from './auth'
import { getDataDir } from './dataDir'
import { logManagerEvent, newTaskId } from './managerLog'

/**
 * Supervises the Discord bot (src/bot/) as its own OS process, spawned via
 * ELECTRON_RUN_AS_NODE rather than imported into this process - a crash in the bot's own
 * ~3000 lines of Discord-API logic can then never take the Manager's own server-management
 * code down with it, and vice versa (see README for the full fault-isolation reasoning that
 * drove this choice over running it in-process). It talks to this same Manager purely over
 * the existing Web Dashboard HTTP API (GET /api/servers, POST /api/servers/:id/rcon, etc.) -
 * exactly the same routes the desktop Console tab and the browser dashboard already use, so
 * there's no separate RCON/ping logic to maintain on the bot's side at all.
 */

let child: ChildProcess | null = null
let lastError: string | null = null

function botScriptPath(): string {
  // out/bot/index.js, a sibling of this bundle's own out/main/ - see scripts/build-bot.mjs.
  return path.join(__dirname, '..', 'bot', 'index.js')
}

function getStateDir(): string {
  return path.join(getDataDir(), 'discord-bot')
}

function getConfigFilePath(): string {
  return path.join(app.getPath('userData'), 'discord-bot-config.json')
}

/** Ensures the bot has a valid Web Dashboard API key when auth is required, reusing the
 *  exact same key-creation path as Settings > "Web dashboard API keys" (generateApiKeyId/
 *  generateApiKeySecret/hashPassword/buildApiKey/saveWebDashboardApiKey) rather than a
 *  parallel credential scheme. A stored secretHash can't be turned back into the plaintext
 *  key the bot needs to send, so instead of trying to "reuse" one across restarts, this
 *  mints a fresh key and revokes whichever one was provisioned last time - cheap, and these
 *  keys are never shown to the user beyond their "Discord Bot (interne)" label in that same
 *  Settings list. When auth is off, no key is needed at all (the Web Dashboard API has no
 *  authentication by design in that mode - see webDashboard.ts). */
async function ensureApiKey(settings: AppSettings): Promise<{ secret: string | undefined; settings: AppSettings }> {
  if (!settings.webDashboardAuthEnabled) {
    if (!settings.discordBotApiKeyId) return { secret: undefined, settings }
    deleteWebDashboardApiKey(settings.discordBotApiKeyId)
    return { secret: undefined, settings: saveSettings({ ...settings, discordBotApiKeyId: '' }) }
  }

  if (settings.discordBotApiKeyId) deleteWebDashboardApiKey(settings.discordBotApiKeyId)
  const id = generateApiKeyId()
  const secret = generateApiKeySecret()
  const secretHash = await hashPassword(secret)
  saveWebDashboardApiKey({ id, label: 'Discord Bot (interne)', secretHash, role: 'moderator', createdAt: Date.now() })
  return { secret: buildApiKey(id, secret), settings: saveSettings({ ...settings, discordBotApiKeyId: id }) }
}

async function buildConfig(settings: AppSettings): Promise<DiscordBotConfig> {
  const { secret } = await ensureApiKey(settings)
  const protocol = settings.webDashboardAuthEnabled ? 'https' : 'http'
  return {
    discordToken: settings.discordBotToken,
    stateDir: getStateDir(),
    devGuildId: settings.discordBotDevGuildId || undefined,
    // Always 127.0.0.1 - the bot only ever runs on the same machine as the Manager that
    // spawned it, regardless of which host interface Settings has the dashboard bound to.
    managerApiUrl: settings.webDashboardEnabled ? `${protocol}://127.0.0.1:${settings.webDashboardPort}` : '',
    managerApiKey: secret,
    managerApiTimeoutMs: 10_000,
    statusChannelId: settings.discordBotStatusChannelId || undefined,
    refreshSeconds: settings.discordBotRefreshSeconds,
    statusEmbedTitle: settings.discordBotStatusEmbedTitle,
    statusEmbedDescription: settings.discordBotStatusEmbedDescription,
    statusEmbedColor: settings.discordBotStatusEmbedColor,
    arkCheckEnabled: settings.discordBotArkCheckEnabled,
    mcStatusChannelId: settings.discordBotMcStatusChannelId || undefined,
    mcRefreshSeconds: settings.discordBotMcRefreshSeconds,
    mcStatusEmbedTitle: settings.discordBotMcStatusEmbedTitle,
    mcStatusEmbedDescription: settings.discordBotMcStatusEmbedDescription,
    mcStatusEmbedColor: settings.discordBotMcStatusEmbedColor,
    mcCheckEnabled: settings.discordBotMcCheckEnabled,
    maintenanceWhitelistIds: settings.discordBotMaintenanceWhitelistIds,
    managerWhitelistIds: settings.discordBotManagerWhitelistIds,
    curseforge: {
      // Reuses the Mods tab's own CurseForge key (Settings > curseforgeApiKey) instead of
      // asking for a second one just for this module.
      apiKey: settings.curseforgeApiKey,
      moduleEnabled: settings.discordBotCurseforgeModuleEnabled,
      defaultModIds: settings.discordBotCurseforgeDefaultModIds,
      checkIntervalMinutes: settings.discordBotCurseforgeCheckIntervalMinutes
    }
  }
}

export function stopDiscordBot(): void {
  if (!child) return
  const toStop = child
  child = null
  toStop.send?.({ type: 'stop' })
  const killTimer = setTimeout(() => {
    if (!toStop.killed) toStop.kill()
  }, 5000)
  toStop.once('exit', () => clearTimeout(killTimer))
}

export async function startDiscordBot(settings: AppSettings): Promise<void> {
  stopDiscordBot()
  lastError = null
  if (!settings.discordBotEnabled || !settings.discordBotToken.trim()) return

  const taskId = newTaskId('discord-bot')
  try {
    const config = await buildConfig(settings)
    fs.mkdirSync(config.stateDir, { recursive: true })
    const configPath = getConfigFilePath()
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8')

    logManagerEvent(taskId, 'Bot Discord', 'Démarrage du bot Discord...')
    const proc = fork(botScriptPath(), [configPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    child = proc

    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split('\n')) {
        if (line.trim()) logManagerEvent(taskId, 'Bot Discord', line.trim())
      }
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split('\n')) {
        if (line.trim()) logManagerEvent(taskId, 'Bot Discord', line.trim(), 'error')
      }
    })
    proc.on('exit', (code) => {
      const level = code === 0 || code === null ? 'info' : 'error'
      logManagerEvent(taskId, 'Bot Discord', `Le bot Discord s'est arrêté (code ${code ?? 'inconnu'}).`, level)
      if (level === 'error') lastError = `Le bot s'est arrêté de façon inattendue (code ${code}). Voir le Journal du Manager.`
      if (child === proc) child = null
    })
    proc.on('error', (err) => {
      lastError = err.message
      logManagerEvent(taskId, 'Bot Discord', `Erreur : ${err.message}`, 'error')
    })
  } catch (err) {
    lastError = (err as Error).message
    logManagerEvent(taskId, 'Bot Discord', `Impossible de démarrer le bot Discord : ${(err as Error).message}`, 'error')
  }
}

export async function applyDiscordBotSettings(settings: AppSettings): Promise<void> {
  if (settings.discordBotEnabled && settings.discordBotToken.trim()) {
    await startDiscordBot(settings)
  } else {
    stopDiscordBot()
  }
}

export function getDiscordBotStatus(): { running: boolean; error: string | null } {
  return { running: child !== null, error: lastError }
}

export async function restartDiscordBot(): Promise<void> {
  await startDiscordBot(getSettings())
}
