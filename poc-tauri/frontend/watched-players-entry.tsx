/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/WatchedPlayersSection.tsx - an
 * eleventh real page. Real, unmodified store.ts functions (listWatchedPlayers/addWatchedPlayer/
 * removeWatchedPlayer) back the "player joined" Discord alert watchlist, a different real
 * subsystem from playerWhitelist (tracking who to *alert on*, not who's allowed to connect).
 * confirmAction()'s native window-focus workaround needs window.api.system.focusWindow, same
 * shim every destructive-action page in this PoC already carries.
 */
import { createRoot } from 'react-dom/client'
import WatchedPlayersSection from '../../src/renderer/src/pages/WatchedPlayersSection'
import { wrapInvoke } from './lib/tauriInvoke'
import type { WatchedPlayerAlert } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
    }
    api: {
      system: {
        focusWindow: () => Promise<void>
      }
      watchedPlayers: {
        list: () => Promise<WatchedPlayerAlert[]>
        add: (value: string, label: string) => Promise<WatchedPlayerAlert[]>
        remove: (id: string) => Promise<WatchedPlayerAlert[]>
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)

window.api = {
  system: {
    focusWindow: () => invoke('window_focus') as Promise<void>
  },
  watchedPlayers: {
    list: () => invoke('watched_players_list') as Promise<WatchedPlayerAlert[]>,
    add: (value, label) => invoke('watched_players_add', { value, label }) as Promise<WatchedPlayerAlert[]>,
    remove: (id) => invoke('watched_players_remove', { id }) as Promise<WatchedPlayerAlert[]>
  }
}

const container = document.getElementById('root')
if (!container) throw new Error('watched-players.html is missing #root')
createRoot(container).render(<WatchedPlayersSection />)
