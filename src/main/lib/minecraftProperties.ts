import fs from 'node:fs'
import path from 'node:path'

export type PropertiesData = Record<string, string>

export function getServerPropertiesPath(installDir: string): string {
  return path.join(installDir, 'server.properties')
}

/**
 * Reads server.properties - Java's flat `key=value` properties format (a `#`/`!`-prefixed
 * line is a comment, blank lines are skipped) - never the `ini` package's INI parser, which
 * expects `[Section]` headers this file doesn't have and interprets `;` as a comment the way
 * property files don't.
 *
 * Deliberately read-only and read fresh on every call, same philosophy as ARK's
 * GameUserSettings.ini (src/main/lib/config.ts): the user manages this file themselves (world
 * settings, RCON password, ...), so MinecraftProfile never stores its own copy of anything
 * this file already covers - server-port, RCON port/password/enabled, motd, max-players.
 */
export function readServerProperties(installDir: string): PropertiesData {
  const filePath = getServerPropertiesPath(installDir)
  if (!fs.existsSync(filePath)) return {}
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const result: PropertiesData = {}
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#') || line.startsWith('!')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim()
      if (key) result[key] = value
    }
    return result
  } catch (err) {
    // A disk-level read failure must not crash whatever asked for this (server status,
    // import detection, the RCON connection details) - same reasoning as every other read
    // this app made resilient to a real report of Windows disk-level failures.
    console.error(`Failed to read ${filePath}:`, (err as Error).message)
    return {}
  }
}

/** The port the server itself listens on for players - 25565 is Minecraft's own documented
 *  default, used whenever server.properties doesn't exist yet or doesn't set it. */
export function getMinecraftServerPort(installDir: string): number {
  const port = Number(readServerProperties(installDir)['server-port'])
  return Number.isFinite(port) && port > 0 ? port : 25565
}

export interface MinecraftRconConfig {
  enabled: boolean
  port: number
  password: string
}

export function getMinecraftRconConfig(installDir: string): MinecraftRconConfig {
  const props = readServerProperties(installDir)
  const port = Number(props['rcon.port'])
  return {
    enabled: props['enable-rcon']?.trim().toLowerCase() === 'true',
    port: Number.isFinite(port) && port > 0 ? port : 25575,
    password: props['rcon.password'] ?? ''
  }
}

/** True once the EULA has been accepted (`eula=true` in eula.txt) - Minecraft's own server
 *  refuses to start at all otherwise, so this is worth surfacing during import rather than
 *  letting the user discover it only when Start silently fails. */
export function isEulaAccepted(installDir: string): boolean {
  const filePath = path.join(installDir, 'eula.txt')
  if (!fs.existsSync(filePath)) return false
  try {
    return /^\s*eula\s*=\s*true\s*$/im.test(fs.readFileSync(filePath, 'utf-8'))
  } catch (err) {
    console.error(`Failed to read ${filePath}:`, (err as Error).message)
    return false
  }
}
