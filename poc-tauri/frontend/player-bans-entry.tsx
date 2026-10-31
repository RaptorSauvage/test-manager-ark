/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/PlayerBansPanel.tsx - a
 * fourteenth real page, the centralized cross-server view of banned players. `playerBans.ban`
 * was already proven in "A third real page" (PlayerRosterPanel.tsx's own ban button shares the
 * same real RPC); this page needed two more real call sites of the same real subsystem -
 * `playerBans.list` (a plain store.ts read) and `playerBans.unban` (mirrors `ban`'s own real
 * RCON-gate-then-write shape: a real `UnbanPlayer` RCON call must succeed before the local ban
 * record is removed).
 */
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import PlayerBansPanel from '../../src/renderer/src/pages/PlayerBansPanel'
import { wrapInvoke } from './lib/tauriInvoke'
import type { BannedPlayer, ServerProfile } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
    }
    api: {
      system: {
        focusWindow: () => Promise<void>
      }
      playerBans: {
        list: () => Promise<BannedPlayer[]>
        ban: (profileId: string, playerId: string, playerName: string, reason: string) => Promise<BannedPlayer[]>
        unban: (profileId: string, playerId: string) => Promise<BannedPlayer[]>
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)

window.api = {
  system: {
    focusWindow: () => invoke('window_focus') as Promise<void>
  },
  playerBans: {
    list: () => invoke('player_bans_list') as Promise<BannedPlayer[]>,
    ban: (profileId, playerId, playerName, reason) =>
      invoke('player_bans_ban', { profileId, playerId, playerName, reason }) as Promise<BannedPlayer[]>,
    unban: (profileId, playerId) => invoke('player_bans_unban', { profileId, playerId }) as Promise<BannedPlayer[]>
  }
}

function PlayerBansPage(): JSX.Element | null {
  const [profiles, setProfiles] = useState<ServerProfile[] | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => setProfiles(result as ServerProfile[]))
  }, [])

  if (!profiles) return null

  return <PlayerBansPanel profiles={profiles} />
}

const container = document.getElementById('root')
if (!container) throw new Error('player-bans.html is missing #root')
createRoot(container).render(<PlayerBansPage />)
