/**
 * Minecraft support - deliberately kept as its own, mostly-separate model from ServerProfile
 * rather than folded into it. ARK: Survival Evolved and ARK: Survival Ascended share enough
 * (engine lineage, launch style, RCON, log format) that one shared profile shape made sense;
 * Minecraft shares almost none of that - no SteamCMD, no fixed executable name, no ?param=
 * launch line, a completely different config/log format - so trying to force it into
 * ServerProfile would mean either polluting it with fields that mean nothing for ARK, or a
 * discriminated union touching every one of its ~50 current consumers. A separate model, its
 * own store collection, and its own Dashboard/menu (this file, minecraftDetect.ts,
 * minecraftProcess.ts, minecraftProperties.ts, ipc/minecraft.ts) is the smaller, safer change.
 *
 * MVP scope - deliberately cut for the first pass, all real gaps rather than oversights:
 * no backups, no scheduled restart, no crash-watch/zombie detection, no persisted CPU/RAM/
 * player history, no Web Dashboard integration, no re-adopting a still-running server across
 * a Manager restart (it'll show as stopped until started again). These all worked for ARK
 * via infrastructure that's straightforward to point at Minecraft later - this first pass is
 * about proving the core loop (import an existing server, launch it our way or via its own
 * script, see its console, stop it cleanly) end to end.
 */

/** How a profile's server process actually gets launched. 'jar' - the Manager builds the
 *  `java -Xms.. -Xmx.. -jar <jar> ..` command line itself (vanilla, Fabric, Paper/Spigot are
 *  all a single directly-runnable jar). 'script' - the Manager just executes an existing
 *  launch script (run.bat/run.sh/start.bat/start.sh) as-is, letting it handle its own
 *  classpath/JVM args - the only reliable way to launch modern Forge, which ships as a
 *  generated script + argfiles rather than one runnable jar, and a safe escape hatch for any
 *  other custom launch setup (a modpack's own start script, etc). */
export type MinecraftLaunchMode = 'jar' | 'script'

export interface MinecraftProfile {
  id: string
  name: string
  /** The server's root folder - where server.properties/eula.txt/the world folder/the jar
   *  or script live. Everything server.properties already covers (port, RCON port/password/
   *  enabled, motd, max-players, ...) is deliberately NOT duplicated here - read fresh from
   *  the file itself (see minecraftProperties.ts), the same "the user manages this file
   *  themselves" philosophy already used for ARK's GameUserSettings.ini. */
  installDir: string
  launchMode: MinecraftLaunchMode
  /** File name (not a full path), relative to installDir. Used when launchMode is 'jar'. */
  jarFileName: string
  /** File name (not a full path), relative to installDir. Used when launchMode is 'script'. */
  scriptFileName: string
  /** -Xms in MB. Only meaningful for launchMode 'jar' - a script already encodes its own
   *  memory args, so the Manager never adds these on top of it. */
  minMemoryMB: number
  /** -Xmx in MB. */
  maxMemoryMB: number
  /** Extra JVM flags, inserted before -jar. Free text, split on whitespace. Jar mode only. */
  extraJvmArgs: string
  /** Program args appended after the jar/script (e.g. "nogui"). Free text, split on
   *  whitespace. Applies to both launch modes - a script can take its own flags too. */
  extraProgramArgs: string
  hidden: boolean
  group: string
  /** Mirrors ServerProfile.startOnManagerLaunch - starts this server automatically when the
   *  Manager launches, unless it's already running (which, for the MVP cut above, it never
   *  is right after a Manager restart). */
  startOnManagerLaunch: boolean
}

export type MinecraftRunState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface MinecraftServerStatus {
  profileId: string
  state: MinecraftRunState
  pid?: number
  startedAt?: number
  cpu?: number
  memoryMB?: number
  players?: string[]
  maxPlayers?: number
  lastError?: string
}

/** One line of live/backlog console output - unlike ARK's parsed/categorized LogEvent, this
 *  is Minecraft's raw console text (piped stdout, not a tailed log file - see
 *  minecraftProcess.ts) shown close to verbatim, since Minecraft's own line format already
 *  carries a timestamp/level prefix that's readable as-is (`[12:03:45] [Server thread/INFO]:
 *  ...`) and categorizing it the way ARK's ShooterGame.log needed would just be reinventing
 *  what the server already did. */
export interface MinecraftConsoleLine {
  text: string
  ts: number
}
