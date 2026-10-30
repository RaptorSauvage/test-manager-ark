/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/PlayerWhitelistPanel.tsx - a
 * fourth real page, and the first whose real Add/Remove buttons don't need a live RCON
 * connection to even become reachable (unlike PlayerRosterPanel's own Kick/Ban/Whitelist
 * buttons, gated behind a live roster row - see "A third real page" in README.md). Every call
 * here (list/add/remove) is the real, tracking-only electron-store write path, no RCON involved
 * at all - the cleanest subsystem in this PoC to drive through the real rendered form itself,
 * not just a direct invoke() bypass.
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import PlayerWhitelistPanel from '../../src/renderer/src/pages/PlayerWhitelistPanel'
import type { ServerProfile, WhitelistedPlayer } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
    }
    api: {
      system: {
        focusWindow: () => Promise<void>
      }
      playerWhitelist: {
        list: () => Promise<WhitelistedPlayer[]>
        add: (profileId: string, playerId: string, playerName: string) => Promise<WhitelistedPlayer[]>
        remove: (profileId: string, playerId: string) => Promise<WhitelistedPlayer[]>
      }
    }
  }
}

const { invoke } = window.__TAURI__.core

window.api = {
  system: {
    focusWindow: () => invoke('window_focus') as Promise<void>
  },
  playerWhitelist: {
    list: () => invoke('player_whitelist_list') as Promise<WhitelistedPlayer[]>,
    add: (profileId, playerId, playerName) =>
      invoke('player_whitelist_add', { profileId, playerId, playerName }) as Promise<WhitelistedPlayer[]>,
    remove: (profileId, playerId) =>
      invoke('player_whitelist_remove', { profileId, playerId }) as Promise<WhitelistedPlayer[]>
  }
}

function PlayerWhitelistPage(): JSX.Element | null {
  const [profiles, setProfiles] = useState<ServerProfile[] | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => setProfiles(result as ServerProfile[]))
  }, [])

  if (profiles === null) return null
  return <PlayerWhitelistPanel profiles={profiles} />
}

const container = document.getElementById('root')
if (!container) throw new Error('player-whitelist.html is missing #root')
createRoot(container).render(<PlayerWhitelistPage />)
