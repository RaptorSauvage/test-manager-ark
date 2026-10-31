/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/PlayerActivityPanel.tsx - a
 * twelfth real page, and read-only (its own doc comment: "nothing to ban/unban or add/remove
 * here"). Real, unmodified store.ts functions (listPlayerActivity/listPlayerSessions) - a third
 * distinct real player subsystem in this PoC, after bans/whitelist ("A third/fourth real page")
 * and watched-players (this same round). Takes the real `profiles` array as a prop, same as the
 * real App.tsx would, to resolve each record's profileIds into real server names.
 */
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import PlayerActivityPanel from '../../src/renderer/src/pages/PlayerActivityPanel'
import { wrapInvoke } from './lib/tauriInvoke'
import type { PlayerActivityRecord, PlayerActivitySession, ServerProfile } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
    }
    api: {
      playerActivity: {
        list: () => Promise<PlayerActivityRecord[]>
        sessions: () => Promise<PlayerActivitySession[]>
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)

window.api = {
  playerActivity: {
    list: () => invoke('player_activity_list') as Promise<PlayerActivityRecord[]>,
    sessions: () => invoke('player_activity_sessions') as Promise<PlayerActivitySession[]>
  }
}

function PlayerActivityPage(): JSX.Element | null {
  const [profiles, setProfiles] = useState<ServerProfile[] | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => setProfiles(result as ServerProfile[]))
  }, [])

  if (!profiles) return null

  return <PlayerActivityPanel profiles={profiles} />
}

const container = document.getElementById('root')
if (!container) throw new Error('player-activity.html is missing #root')
createRoot(container).render(<PlayerActivityPage />)
