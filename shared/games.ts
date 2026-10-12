// Groundwork for multi-game support: a small registry describing what each supported game
// looks like, so the rest of the app can ask "does this game have maps?" or "what's its
// SteamCMD app id?" instead of assuming ARK: Survival Ascended everywhere.
//
// ARK: Survival Evolved's technical fields (steamAppId, executableWin/Linux, usesQueryPort)
// are confirmed against public documentation (Steam community discussions, LinuxGSM's ARK:SE
// docs, community wikis - ARK's own wiki was unreachable from this environment) - not against
// a real running install. supportsPlayerProfileBackups stays false until its own log
// format/.profilebak naming is verified the way ARK:SA's was (see README). A handful of
// ARK:SA launch flags with unconfirmed ARK:SE support (-ServerPlatform= crossplay,
// -DestroyTamesOverLevel=, passive/dev mods' -passivemods=/-dev suffix) are simply never
// emitted for ARK:SE profiles in serverProcess.ts's buildLaunchArgs, rather than guessed at -
// safer to omit an uncertain flag than risk a wrong one silently breaking a real server.

export type GameId = 'ark-ascended' | 'ark-evolved'

export interface GameDefinition {
  id: GameId
  /** Shown in the UI once there's more than one game to choose from. */
  displayName: string
  /** 'available' - profiles can be created for this game today. 'planned' - listed for
   *  visibility (icon, name) but profile creation isn't wired up for it yet. */
  status: 'available' | 'planned'
  /** Icon file name, present under both build/games/ (electron-builder resource / Web
   *  Dashboard route) and src/renderer/src/assets/games/ (desktop UI import). */
  iconFileName: string
  /** Whether profiles for this game have a map picker (named maps, e.g. "TheIsland_WP"). */
  supportsMaps: boolean
  /** Whether this game's mods are identified by a Steam Workshop id, passed on the
   *  command line the way ARK:SA's -mods= flag works. */
  supportsWorkshopMods: boolean
  /** Whether this game's install/update goes through SteamCMD. */
  usesSteamCmd: boolean
  /** SteamCMD app id for the dedicated server (anonymous login) - only meaningful when
   *  usesSteamCmd is true. */
  steamAppId: string
  /** Dedicated server executable path, relative to the install directory. */
  executableWin: string
  executableLinux: string
  /** Whether this game's launch line needs a QueryPort distinct from the game Port (ARK:SE
   *  does; ARK:SA merged the two - see ServerProfile.queryPort). */
  usesQueryPort: boolean
  /** Whether this game exposes a "wipe wild dinos" RCON action independent of restarts
   *  (ARK-specific terminology/feature - kept as its own flag rather than generalized,
   *  since a future non-ARK game is unlikely to have a directly equivalent concept). */
  supportsDinoWipe: boolean
  /** Whether this game supports backing up an individual player's profile/save data,
   *  detected by tailing the server's log for join/leave events (see playerBackup.ts).
   *  Only confirmed against a real ARK:SA setup so far (see README) - left false for ARK
   *  Evolved until its own log format/.profilebak naming is verified, even though the
   *  underlying game concept (a player profile file) does exist there too. */
  supportsPlayerProfileBackups: boolean
  /** Whether checking SteamCMD's public branch build id against the installed one (the
   *  "New update"/"A server update is available" check) is meaningful for this game.
   *  ARK: Survival Evolved's dedicated server is no longer developed - its branch build id
   *  essentially never changes, so the check has nothing useful to say and is skipped
   *  entirely rather than showing a permanently-stale "No new update available." */
  supportsUpdateCheck: boolean
}

export const GAMES: Record<GameId, GameDefinition> = {
  'ark-ascended': {
    id: 'ark-ascended',
    displayName: 'ARK: Survival Ascended',
    status: 'available',
    iconFileName: 'ark-ascended.png',
    supportsMaps: true,
    supportsWorkshopMods: true,
    usesSteamCmd: true,
    steamAppId: '2430930',
    executableWin: 'ShooterGame/Binaries/Win64/ArkAscendedServer.exe',
    executableLinux: 'ShooterGame/Binaries/Linux/ArkAscendedServer',
    usesQueryPort: false,
    supportsDinoWipe: true,
    supportsPlayerProfileBackups: true,
    supportsUpdateCheck: true
  },
  'ark-evolved': {
    id: 'ark-evolved',
    displayName: 'ARK: Survival Evolved',
    status: 'available',
    iconFileName: 'ark-evolved.png',
    supportsMaps: true,
    supportsWorkshopMods: true,
    usesSteamCmd: true,
    steamAppId: '376030',
    executableWin: 'ShooterGame/Binaries/Win64/ShooterGameServer.exe',
    executableLinux: 'ShooterGame/Binaries/Linux/ShooterGameServer',
    usesQueryPort: true,
    supportsDinoWipe: true,
    supportsPlayerProfileBackups: false,
    supportsUpdateCheck: false
  }
}

export function getGameDefinition(id: GameId): GameDefinition {
  return GAMES[id]
}

export function listGameDefinitions(): GameDefinition[] {
  return Object.values(GAMES)
}
