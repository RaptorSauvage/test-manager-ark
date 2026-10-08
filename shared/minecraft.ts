import type { InstalledMinecraftMod } from './minecraftMods'

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
 * MVP scope - deliberately cut for the first pass, all real gaps rather than oversights: no
 * backups, no crash-watch/zombie detection, no persisted CPU/RAM/player history, no Web
 * Dashboard integration. Scheduled restart and re-adopting a still-running server across a
 * Manager restart, both originally cut too, were added in a follow-up pass - see
 * minecraftScheduledActions.ts and minecraftProcess.ts's adoptPersistedMinecraftProcesses.
 */

/** How a profile's server process actually gets launched. 'jar' - the Manager builds the
 *  `java -Xms.. -Xmx.. -jar <jar> ..` command line itself (vanilla, Fabric, Paper/Spigot are
 *  all a single directly-runnable jar). 'script' - the Manager just executes an existing
 *  launch script (run.bat/run.sh/start.bat/start.sh) as-is, letting it handle its own
 *  classpath/JVM args - the only reliable way to launch modern Forge, which ships as a
 *  generated script + argfiles rather than one runnable jar, and a safe escape hatch for any
 *  other custom launch setup (a modpack's own start script, etc). */
export type MinecraftLaunchMode = 'jar' | 'script'

/** Best-effort guess at what's actually running - purely cosmetic (the Dashboard card, and
 *  a manual override in Settings if the guess is wrong), never used to change launch
 *  behavior. Detected from the jar/script file name (minecraftDetect.ts's
 *  detectMinecraftServerType) since none of these ship any other cheap, reliable signal to
 *  read instead. */
export type MinecraftServerType = 'vanilla' | 'paper' | 'spigot' | 'fabric' | 'forge' | 'unknown'

export interface MinecraftProfile {
  id: string
  name: string
  serverType: MinecraftServerType
  /** The server's root folder - where server.properties/eula.txt/the world folder/the jar
   *  or script live. Everything server.properties already covers (port, RCON port/password/
   *  enabled, motd, max-players, ...) is deliberately NOT duplicated here - read fresh from
   *  the file itself (see minecraftProperties.ts), the same "the user manages this file
   *  themselves" philosophy already used for ARK's GameUserSettings.ini. */
  installDir: string
  /** The server's actual Minecraft game version, e.g. "1.20.1" - free text, set by the user
   *  (Start Settings tab), since none of the detection this app already does (jar/script file
   *  name) reliably reveals it. Needed to filter compatible mod/plugin versions when browsing
   *  Modrinth/CurseForge (minecraftMods.ts) - an empty value just means "unknown", and the
   *  Mods tab asks for it before letting the user search. */
  minecraftVersion: string
  launchMode: MinecraftLaunchMode
  /** File name (not a full path), relative to installDir. Used when launchMode is 'jar'. */
  jarFileName: string
  /** File name (not a full path), relative to installDir. Used when launchMode is 'script'. */
  scriptFileName: string
  /** -Xms in MB. Applies to both launch modes: in 'jar' mode, built straight onto the java
   *  command line; in 'script' mode, written to user_jvm_args.txt before every start (the
   *  argfile modern Forge's own generated run.bat/run.sh already reads for this - see
   *  minecraftProperties.ts's writeUserJvmArgs) rather than dropped, since the Manager has
   *  no other way to influence a script it executes as-is. Has no effect on an older Forge
   *  version or a fully custom script that doesn't happen to read that file. */
  minMemoryMB: number
  /** -Xmx in MB. */
  maxMemoryMB: number
  /** Extra JVM flags, inserted before -jar in 'jar' mode, or into user_jvm_args.txt in
   *  'script' mode (see minMemoryMB above - same caveat). Free text, split on whitespace. */
  extraJvmArgs: string
  /** Program args appended after the jar/script (e.g. "nogui"). Free text, split on
   *  whitespace. Applies to both launch modes - a script can take its own flags too. */
  extraProgramArgs: string
  hidden: boolean
  group: string
  /** Mirrors ServerProfile.startOnManagerLaunch - starts this server automatically when the
   *  Manager launches, unless it's already running (re-adopted from a previous session -
   *  see adoptPersistedMinecraftProcesses in minecraftProcess.ts). */
  startOnManagerLaunch: boolean
  /** Scheduled restart - same day-of-week + time picker and cron-driven mechanism as ARK's
   *  own ServerProfile.scheduledRestart* fields (see shared/scheduleTime.ts,
   *  minecraftScheduledActions.ts). No update-after-shutdown option here - there's no
   *  SteamCMD-equivalent update mechanism for Minecraft to run. */
  scheduledRestartEnabled: boolean
  scheduledRestartTime: string
  scheduledRestartDays: number[]
  /** If false, the schedule just stops the server at the scheduled time (a "scheduled
   *  shutdown") rather than restarting it. */
  scheduledRestartStartAfter: boolean
  /** Directory world backups are written to - same "one folder per profile, anything in it
   *  is fair game" model as ServerProfile.backupDir. */
  backupDir: string
  /** How many backups to keep per profile before pruning the oldest. */
  maxBackups: number
  /** Optional cron expression for automatic backups, e.g. every 6 hours. */
  backupSchedule?: string
  backupScheduleEnabled: boolean
  /** Mods/plugins this Manager has installed for this server (see minecraftMods.ts/
   *  shared/minecraftMods.ts) - empty for vanilla, or for any server the Mods tab hasn't
   *  been used on yet. */
  installedMods: InstalledMinecraftMod[]
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
  /** False for a server re-adopted from a previous Manager session (see
   *  adoptPersistedMinecraftProcesses) - there's no live ChildProcess handle for one of
   *  those, so the Console tab has no piped stdout to show and no stdin to send commands to
   *  (sendCommand falls back to RCON, if enabled, instead). Always true for a server this
   *  session actually started itself. */
  consoleAvailable?: boolean
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

/** Flat `key=value` data read from / written to server.properties - see
 *  minecraftProperties.ts (main process) for the actual read/write logic. Shared here since
 *  both the Server Settings tab (renderer) and the IPC layer need the shape. */
export type MinecraftPropertiesData = Record<string, string>
