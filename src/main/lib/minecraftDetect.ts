import fs from 'node:fs'
import path from 'node:path'
import { platform } from 'node:process'
import { randomUUID } from 'node:crypto'
import type { MinecraftLaunchMode, MinecraftProfile, MinecraftServerType } from '@shared/minecraft'

const SCRIPT_NAME_RE = platform === 'win32' ? /^(run|start)\.bat$/i : /^(run|start)\.sh$/i

export interface DetectedLaunchable {
  launchMode: MinecraftLaunchMode
  jarFileName: string
  scriptFileName: string
  serverType: MinecraftServerType
}

/**
 * Best-effort guess at the server flavor, purely from the jar/script file name - none of
 * these ship any other cheap, reliable marker to read instead (no manifest, no version
 * file with a consistent name across all of them). A script launch is treated as Forge
 * unless the name itself says otherwise (or, when `installDir` is given, the libraries/
 * folder says otherwise - see below): modern Forge (1.17+) is the actual reason
 * launchMode 'script' exists at all (see shared/minecraft.ts), so it's the far more likely
 * case than "someone's fully custom launcher happens to be named something else" - wrong
 * either way is a one-click fix via the manual override in Settings, not a functional
 * problem (this never affects how the server is actually launched).
 *
 * NeoForge is checked before plain Forge - "neoforge" contains "forge" as a substring, so
 * checking the other order would misclassify every NeoForge jar/script as Forge instead.
 * NeoForge's own generated run.sh/run.bat is named identically to modern Forge's (just
 * "run.sh"/"run.bat", no "neoforge" in the name), so the file name alone can't tell the two
 * apart for a script launch at all - when `installDir` is passed, this instead checks which
 * of libraries/net/neoforged or libraries/net/minecraftforge actually exists on disk (both
 * installers always create their own, never the other's), a reliable signal the file name
 * alone doesn't carry.
 */
export function detectMinecraftServerType(
  launchMode: MinecraftLaunchMode,
  jarFileName: string,
  scriptFileName: string,
  installDir?: string
): MinecraftServerType {
  const name = (launchMode === 'jar' ? jarFileName : scriptFileName).toLowerCase()
  if (name.includes('fabric')) return 'fabric'
  if (name.includes('paper')) return 'paper'
  if (name.includes('spigot') || name.includes('bukkit')) return 'spigot'
  if (name.includes('neoforge')) return 'neoforge'
  if (name.includes('forge')) return 'forge'
  if (launchMode === 'script') {
    if (installDir && fs.existsSync(path.join(installDir, 'libraries', 'net', 'neoforged'))) return 'neoforge'
    return 'forge'
  }
  return name ? 'vanilla' : 'unknown'
}

/**
 * Looks for a way to launch the server in `installDir`'s own root (not recursively - every
 * server type this looks for puts its launch script/jar directly in the root, and searching
 * deeper risks picking up an unrelated jar from a mods/plugins/libraries folder). Prefers a
 * launch script over a bare jar when both exist: modern Forge ships only as a generated
 * script + argfiles (see shared/minecraft.ts's own doc comment) with no single runnable jar
 * at all, so a script's presence is the strongest signal of "this needs to be launched a
 * specific way, don't try to build the command yourself." Vanilla/Fabric/Paper/Spigot are a
 * single runnable jar either way, so a script for one of those (if the user has their own) is
 * just as valid a signal.
 *
 * Returns null if nothing launchable was found at all - the caller decides whether that's a
 * hard stop (import) or just "user needs to fill this in by hand" (Settings tab re-detect).
 */
export function detectMinecraftLaunchable(installDir: string): DetectedLaunchable | null {
  if (!fs.existsSync(installDir)) return null
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(installDir, { withFileTypes: true })
  } catch (err) {
    console.error(`Failed to list ${installDir}:`, (err as Error).message)
    return null
  }

  const script = entries.find((e) => e.isFile() && SCRIPT_NAME_RE.test(e.name))
  if (script) {
    return {
      launchMode: 'script',
      jarFileName: '',
      scriptFileName: script.name,
      serverType: detectMinecraftServerType('script', '', script.name, installDir)
    }
  }

  // Prefer a jar whose name doesn't look like an installer (Forge/Fabric installers leave
  // their own jar sitting in the root right next to the one that's actually meant to be run)
  // - not foolproof, just a better first guess than "the first jar found" for the user to
  // confirm/correct in the import review step.
  const jars = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.jar'))
  const jar = jars.find((e) => !/installer/i.test(e.name)) ?? jars[0]
  if (jar) {
    return {
      launchMode: 'jar',
      jarFileName: jar.name,
      scriptFileName: '',
      serverType: detectMinecraftServerType('jar', jar.name, '')
    }
  }

  return null
}

/** True if `installDir` looks like a set-up (already run at least once, or at minimum
 *  launchable) Minecraft server - server.properties/eula.txt only exist after the server's
 *  own first run, so a launchable file is checked as a fallback for "downloaded but never
 *  started yet" installs, which are still worth importing. */
export function isValidMinecraftInstall(installDir: string): boolean {
  if (!fs.existsSync(installDir)) return false
  if (fs.existsSync(path.join(installDir, 'server.properties'))) return true
  if (fs.existsSync(path.join(installDir, 'eula.txt'))) return true
  return detectMinecraftLaunchable(installDir) !== null
}

/** Builds a best-effort profile for a freshly-imported install - the caller (the Settings
 *  tab, opened straight after import) is expected to let the user review/correct every
 *  detected field before it's really "real", the same pattern as ARK profile import. */
export function detectMinecraftProfile(installDir: string): MinecraftProfile {
  const launchable = detectMinecraftLaunchable(installDir)
  const folderName = path.basename(installDir) || 'Minecraft Server'
  return {
    id: randomUUID(),
    name: folderName,
    serverType: launchable?.serverType ?? 'unknown',
    installDir,
    minecraftVersion: '',
    launchMode: launchable?.launchMode ?? 'jar',
    jarFileName: launchable?.jarFileName ?? '',
    scriptFileName: launchable?.scriptFileName ?? '',
    minMemoryMB: 2048,
    maxMemoryMB: 4096,
    extraJvmArgs: '',
    extraProgramArgs: 'nogui',
    hidden: false,
    group: '',
    startOnManagerLaunch: false,
    scheduledRestartEnabled: false,
    scheduledRestartTime: '00:00',
    scheduledRestartDays: [],
    scheduledRestartStartAfter: true,
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    installedMods: []
  }
}
