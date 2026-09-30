import fs from 'node:fs'
import path from 'node:path'
import type { MinecraftPropertiesData } from '@shared/minecraft'

export type PropertiesData = MinecraftPropertiesData

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

/**
 * Writes user_jvm_args.txt - unlike everything else in this file, a Manager-owned file
 * rather than one the user manages themselves, since it's how a launchMode 'script' server
 * gets its memory/JVM args at all. When the Manager can't build the java command line itself
 * (launchMode 'script' runs an existing run.bat/run.sh as-is - see shared/minecraft.ts),
 * modern Forge's own generated script already reads this exact file (a Java "argfile": one
 * argument per line, `#`-prefixed lines are comments) for -Xms/-Xmx and anything else - so
 * writing the profile's current values here before every start is what makes editing memory
 * in Settings actually take effect for a script-launched server. Overwritten wholesale on
 * every start; a script from an older Forge version (or a fully custom one) that doesn't
 * happen to read this file simply ignores it, harmlessly.
 */
export function writeUserJvmArgs(installDir: string, args: string[]): void {
  const filePath = path.join(installDir, 'user_jvm_args.txt')
  try {
    fs.writeFileSync(filePath, args.map((arg) => `${arg}\n`).join(''), 'utf-8')
  } catch (err) {
    // Best-effort - a failed write here just means the server starts with whatever memory
    // its own script/user_jvm_args.txt already had, not a reason to block Start entirely.
    console.error(`Failed to write ${filePath} (non-fatal):`, (err as Error).message)
  }
}

/**
 * Applies `updates` to server.properties - the one place in this file that writes the file
 * the user otherwise manages themselves (the Server Settings tab's properties editor).
 * Line-based, not a full rewrite: each updated key replaces just the value on its existing
 * `key=value` line if one exists (keeping the file's own ordering, comments, and any
 * key this app doesn't know about - a plugin's own custom property, for instance - untouched),
 * and only a key with no existing line at all is appended at the end. Aborts without writing
 * anything if the read itself fails, rather than risking silently dropping every existing
 * line the way starting from an empty file would - same data-loss-prevention reasoning as
 * ARK's gameConfigWrite.ts.
 */
export function upsertServerPropertiesKeys(installDir: string, updates: PropertiesData): void {
  const filePath = getServerPropertiesPath(installDir)
  let lines: string[] = []
  if (fs.existsSync(filePath)) {
    try {
      lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)
    } catch (err) {
      console.error(`Failed to read ${filePath} - aborting write to avoid clobbering it:`, (err as Error).message)
      return
    }
  }

  const remaining = new Map(Object.entries(updates))
  const rewritten = lines.map((rawLine) => {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return rawLine
    const eq = trimmed.indexOf('=')
    if (eq === -1) return rawLine
    const key = trimmed.slice(0, eq).trim()
    if (!remaining.has(key)) return rawLine
    const value = remaining.get(key)!
    remaining.delete(key)
    return `${key}=${value}`
  })
  for (const [key, value] of remaining) {
    rewritten.push(`${key}=${value}`)
  }

  try {
    fs.writeFileSync(filePath, rewritten.join('\n'), 'utf-8')
  } catch (err) {
    console.error(`Failed to write ${filePath}:`, (err as Error).message)
  }
}
