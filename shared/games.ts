// Groundwork for multi-game support: a small registry describing what each supported (or
// planned) game looks like, so the rest of the app can eventually ask "does this game have
// maps?" instead of assuming ARK everywhere. ARK: Survival Ascended is the only game a
// profile can actually be created for right now (status: 'available') - ServerProfile.game
// is always 'ark-ascended', and nothing branches on these capability flags yet.
//
// ARK: Survival Evolved is listed here (status: 'planned') purely as groundwork and to
// give it a real icon/name in the UI - its capability flags below are believed correct
// (ASE predates ASA and most of the launch-flag surface carries over), but launching a real
// ASE server also needs its executable name/path, SteamCMD app id, and exact launch-arg
// differences (e.g. ASE's separate QueryPort, which ASA dropped - see profileMigration.ts's
// removed `queryPort` field) confirmed against a real install before profile creation opens
// up for it. Until then it's display-only.

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
    supportsDinoWipe: true,
    supportsPlayerProfileBackups: true
  },
  'ark-evolved': {
    id: 'ark-evolved',
    displayName: 'ARK: Survival Evolved',
    status: 'planned',
    iconFileName: 'ark-evolved.png',
    supportsMaps: true,
    supportsWorkshopMods: true,
    usesSteamCmd: true,
    supportsDinoWipe: true,
    supportsPlayerProfileBackups: false
  }
}

export function getGameDefinition(id: GameId): GameDefinition {
  return GAMES[id]
}

export function listGameDefinitions(): GameDefinition[] {
  return Object.values(GAMES)
}
