import { Rcon } from 'rcon-client'
import type { RconResult } from '@shared/types'
import { getMinecraftRconConfig } from './minecraftProperties'

/**
 * Same ECONNRESET-safe connection pattern as rcon.ts's sendRconCommand (constructing `Rcon`
 * directly and attaching a no-op 'error' listener before connect(), rather than the
 * `Rcon.connect(config)` static helper - see that file's own comment for the full reasoning).
 * Kept as its own small copy here, rather than a shared import, since Minecraft's RCON
 * connection details come from server.properties (via minecraftProperties.ts) instead of a
 * ServerProfile's own fields - reused as a secondary path to ARK's dedicated stdin channel
 * (minecraftProcess.ts's sendStdinCommand), for player-list queries and any server this
 * Manager didn't itself spawn.
 */
export async function sendMinecraftRconCommand(installDir: string, command: string): Promise<RconResult> {
  const config = getMinecraftRconConfig(installDir)
  if (!config.enabled) {
    return { ok: false, error: 'RCON is not enabled for this server (enable-rcon=true is required in server.properties)' }
  }
  if (!config.password) {
    return { ok: false, error: 'No rcon.password set in server.properties' }
  }

  let rcon: Rcon | undefined
  try {
    rcon = new Rcon({ host: '127.0.0.1', port: config.port, password: config.password, timeout: 5000 })
    rcon.on('error', () => {})
    await rcon.connect()
    const response = await rcon.send(command)
    return { ok: true, response }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    rcon?.end().catch(() => {})
  }
}

/**
 * Parses Minecraft's own `list` command response. Wording differs slightly by version
 * ("There are 2 of a max of 20 players online: Alice, Bob" vs "There are 2/20 players
 * online: Alice, Bob"), but both always put the two counts before the first colon and the
 * comma-separated player names (if any) after it - the only assumption this relies on.
 */
export function parseMinecraftPlayerList(raw: string): { players: string[]; maxPlayers?: number } {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { players: [] }

  const colonIndex = trimmed.indexOf(':')
  const header = colonIndex >= 0 ? trimmed.slice(0, colonIndex) : trimmed
  const nums = header.match(/\d+/g)
  const maxPlayers = nums && nums.length >= 2 ? Number(nums[1]) : undefined

  const namesPart = colonIndex >= 0 ? trimmed.slice(colonIndex + 1).trim() : ''
  const players = namesPart
    ? namesPart
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
    : []

  return { players, maxPlayers }
}
