// Groundwork for multi-game support: a small registry describing what each supported
// game looks like, so the rest of the app can eventually ask "does this game have maps?"
// instead of assuming ARK everywhere. For now there is exactly one entry (ARK: Survival
// Ascended) and nothing reads these capability flags yet - ServerProfile.game exists and
// is always 'ark-ascended', but no behavior branches on it. That's deliberate: this is
// step one of the multi-game rollout (see the multi-game-support branch), formalizing the
// seam before a second game exists to prove it against.

export type GameId = 'ark-ascended'

export interface GameDefinition {
  id: GameId
  /** Shown in the UI once there's more than one game to choose from. */
  displayName: string
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
   *  detected by tailing the server's log for join/leave events (see playerBackup.ts). */
  supportsPlayerProfileBackups: boolean
}

export const GAMES: Record<GameId, GameDefinition> = {
  'ark-ascended': {
    id: 'ark-ascended',
    displayName: 'ARK: Survival Ascended',
    supportsMaps: true,
    supportsWorkshopMods: true,
    usesSteamCmd: true,
    supportsDinoWipe: true,
    supportsPlayerProfileBackups: true
  }
}

export function getGameDefinition(id: GameId): GameDefinition {
  return GAMES[id]
}
