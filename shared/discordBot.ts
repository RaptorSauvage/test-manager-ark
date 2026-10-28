// Shared between the main process (src/main/lib/discordBot.ts, which builds this config from
// Settings and spawns the bot) and the bot's own child process (src/bot/), so the two can
// never quietly disagree on shape. The bot never talks to anything other than Discord, the
// Manager's own local Web Dashboard API, CurseForge, and a handful of third-party status
// pages - see BotConfig's own fields below for exactly what it's given at spawn time.

/** Written to a JSON file by the main process right before spawning the bot, and read back
 *  via `process.argv[2]` - see discordBotRuntime.ts's own doc comment for why a file instead
 *  of an env var or IPC message (restart-safe, no timing dependency on the child being ready
 *  to receive an IPC message before the parent writes to it). Every field the standalone
 *  Python bot used to need per-ARK-server (name/ip/rcon port/password/map/max players) is
 *  gone - the Manager already knows all of that for its own profiles, so the bot gets the
 *  full live server list from `GET /api/servers` instead of a static duplicate. */
export interface DiscordBotConfig {
  discordToken: string
  /** Directory the bot persists its own state to (maintenance flags, check on/off,
   *  schedules, CurseForge tracking) - a subfolder of the Manager's own userData, created by
   *  the main process before spawning so the bot never has to guess a path of its own. */
  stateDir: string
  /** Discord guild id to sync slash commands to instantly instead of waiting for the ~1h
   *  global sync - optional, same as the standalone bot's DEV_GUILD_ID. */
  devGuildId?: string

  /** Base URL of the Manager's own Web Dashboard (e.g. "http://127.0.0.1:8090"), filled in
   *  automatically from Settings by the main process - never user-entered, since the bot
   *  only ever talks to the Manager that spawned it. */
  managerApiUrl: string
  /** Set only when Settings > "Require access token" is on - see discordBot.ts's own doc
   *  comment for why this is auto-provisioned rather than asked of the user. */
  managerApiKey?: string
  managerApiTimeoutMs: number

  statusChannelId?: string
  refreshSeconds: number
  statusEmbedTitle: string
  statusEmbedDescription: string
  /** Hex color, with or without '#'. */
  statusEmbedColor: string
  arkCheckEnabled: boolean

  mcStatusChannelId?: string
  mcRefreshSeconds: number
  mcStatusEmbedTitle: string
  mcStatusEmbedDescription: string
  mcStatusEmbedColor: string
  mcCheckEnabled: boolean

  /** AppSettings.discordBotDisplayEnabled combined with AppSettings.discordBotPresenceEnabled
   *  already, by the main process (see discordBot.ts's buildConfig) - the bot itself only
   *  needs this one flag, not the two separate settings it was folded from. See
   *  statusRefresh.ts's updateBotPresence. */
  presenceEnabled: boolean
  /** Same combination (discordBotDisplayEnabled && discordBotChatBridgeEnabled), for the
   *  bot's own inbound half of the chat relay (Events.MessageCreate in src/bot/index.ts) -
   *  the outbound half (discordChatBridgeWatch.ts, in the main process) checks the same two
   *  settings directly rather than through this config, since it doesn't go through the bot
   *  process at all until notifyGameEvent actually sends something. */
  chatBridgeEnabled: boolean

  /** Discord user ids, as decimal strings (snowflakes exceed Number's safe integer range). */
  maintenanceWhitelistIds: string[]
  managerWhitelistIds: string[]

  /** Mirrors `AppSettings.groupOrder`/`minecraftGroupOrder` - the same group display order the
   *  desktop Dashboard lets the user drag-and-drop, so the status embed's group fields appear
   *  in that order too instead of alphabetically. A group not listed here is appended after
   *  every explicitly-ordered one, alphabetically among its peers. */
  groupOrder: string[]
  minecraftGroupOrder: string[]

  curseforge: DiscordBotCurseForgeConfig

  /** Channel the "player joined" alert posts to - see playerJoinAlertWatch.ts in the main
   *  process, which matches join events against Settings' watched-player list and sends a
   *  live IPC message (not part of this config file, since the match happens after the bot
   *  is already running) rather than a slash command or poll. */
  playerAlertChannelId?: string
}

export interface DiscordBotCurseForgeConfig {
  apiKey: string
  moduleEnabled: boolean
  /** Mod ids tracked by default for a Discord server with no /addmod configuration yet. */
  defaultModIds: string[]
  checkIntervalMinutes: number
}

/** One entry of `GET /api/servers`'s response - see webDashboard.ts's own route for the
 *  authoritative shape. Both ARK and Minecraft servers share this, discriminated by
 *  `gameDisplayName === 'Minecraft'` (set, hardcoded, by that same route). */
export interface ManagerServerInfo {
  id: string
  name: string
  group: string
  maxPlayers: number
  state: string
  players: string[]
  cpu: number | null
  memoryMB: number | null
  startedAt: number | null
  gameVersion: string | null
  gameDisplayName: string
  /** Minecraft-only (always set on a Minecraft entry, always absent on an ARK one) - the
   *  cheapest reliable way to tell the two apart client-side without hardcoding game ids. */
  serverType?: string
  /** ARK-only - the profile's own ServerProfile.discordChatChannelId/discordEventsChannelId,
   *  absent/blank when not set. The bot's inbound chat relay (src/bot/index.ts) uses
   *  discordChatChannelId to map an incoming Discord message's channel back to every profile
   *  that should receive it - the outbound direction (game events -> Discord) doesn't need
   *  this at all, since the main process already knows each profile's own channel id and
   *  resolves it before ever messaging the bot (see discordChatBridgeWatch.ts). */
  discordChatChannelId?: string
  discordEventsChannelId?: string
}

export function isMinecraftServerInfo(server: ManagerServerInfo): boolean {
  return server.serverType !== undefined
}
