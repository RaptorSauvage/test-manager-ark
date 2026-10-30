/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/PlayerRosterPanel.tsx - the
 * third real UI page in this PoC, and the first in a different subsystem entirely (player
 * management: a live RCON-driven roster plus the Manager's own persisted ban/whitelist records)
 * rather than another angle on profiles or the server process. window.api.playerRoster.list/
 * .kick and window.api.playerBans.ban all go through the real sendRconCommand (lib/rcon.ts) -
 * genuinely RCON-gated, so they fail honestly against this PoC's fake profiles (no real RCON
 * server, no ServerAdminPassword) exactly the way they would against any real server nobody's
 * authenticated against yet, visible right in the real component's own error-message UI.
 * window.api.playerWhitelist.add is the one path with no RCON involved at all (tracking-only,
 * see playerWhitelist.ts's own comment) - a real, fully successful write every time.
 * window.api.system.focusWindow backs confirmAction()'s real Electron/Windows focus-loss
 * workaround (lib/confirmAction.ts/lib/windowFocus.ts) - ported as a Rust-only window_focus
 * command, the same main-process/window-level shape as dialog_select_directory.
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import PlayerRosterPanel from '../../src/renderer/src/pages/PlayerRosterPanel'
import type { ServerProfile, PlayerRosterEntry, BannedPlayer, WhitelistedPlayer } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
    }
    api: {
      system: {
        focusWindow: () => Promise<void>
      }
      playerRoster: {
        list: (profileId: string) => Promise<PlayerRosterEntry[]>
        kick: (profileId: string, playerId: string) => Promise<void>
      }
      playerBans: {
        ban: (profileId: string, playerId: string, playerName: string, reason: string) => Promise<BannedPlayer[]>
      }
      playerWhitelist: {
        add: (profileId: string, playerId: string, playerName: string) => Promise<WhitelistedPlayer[]>
      }
    }
  }
}

const { invoke } = window.__TAURI__.core

window.api = {
  system: {
    focusWindow: () => invoke('window_focus') as Promise<void>
  },
  playerRoster: {
    list: (profileId) => invoke('player_roster_list', { profileId }) as Promise<PlayerRosterEntry[]>,
    kick: (profileId, playerId) => invoke('player_roster_kick', { profileId, playerId }) as Promise<void>
  },
  playerBans: {
    ban: (profileId, playerId, playerName, reason) =>
      invoke('player_bans_ban', { profileId, playerId, playerName, reason }) as Promise<BannedPlayer[]>
  },
  playerWhitelist: {
    add: (profileId, playerId, playerName) =>
      invoke('player_whitelist_add', { profileId, playerId, playerName }) as Promise<WhitelistedPlayer[]>
  }
}

// Same "wait for the real fetch before mounting" fix the ProfileManagementView round found and
// applied - App.tsx only ever mounts PlayerRosterPanel once its own app-wide `profiles` state is
// already loaded, never with an empty array that fills in later.
function PlayerRosterPage(): JSX.Element | null {
  const [profiles, setProfiles] = useState<ServerProfile[] | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => setProfiles(result as ServerProfile[]))
  }, [])

  if (profiles === null) return null
  return <PlayerRosterPanel profiles={profiles} />
}

const container = document.getElementById('root')
if (!container) throw new Error('player-roster.html is missing #root')
createRoot(container).render(<PlayerRosterPage />)
