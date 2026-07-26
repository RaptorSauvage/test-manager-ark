import { Rcon } from 'rcon-client'
import type { ServerProfile, RconResult } from '@shared/types'

export async function sendRconCommand(profile: ServerProfile, command: string): Promise<RconResult> {
  if (!profile.rconPassword) {
    return { ok: false, error: 'No RCON password configured for this profile' }
  }

  let rcon: Rcon | undefined
  try {
    rcon = await Rcon.connect({
      host: '127.0.0.1',
      port: profile.rconPort,
      password: profile.rconPassword,
      timeout: 5000
    })
    const response = await rcon.send(command)
    return { ok: true, response }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    rcon?.end()
  }
}

/** Parses the raw text ARK's RCON "ListPlayers" command returns into player names. */
export function parsePlayerList(raw: string): string[] {
  if (!raw || /no players connected/i.test(raw)) return []
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Typical line: "0. PlayerName, 000211a1b2c3d4e5f6..."
      const match = line.match(/^\d+\.\s*(.+?),\s*[0-9A-Fa-f]+$/)
      return match ? match[1] : line
    })
}

export async function listPlayers(profile: ServerProfile): Promise<string[]> {
  const result = await sendRconCommand(profile, 'ListPlayers')
  if (!result.ok || !result.response) return []
  return parsePlayerList(result.response)
}
