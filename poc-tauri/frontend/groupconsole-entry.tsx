/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/GroupConsoleView.tsx - a
 * seventeenth real page, and the page "A fifteenth real page"'s own cluster-data-entry.tsx
 * honestly noted as not ported yet (its onOpenGroup just logged to the console). Merges every
 * profile in a dashboard group's live log feed into one chronological view. Real, unmodified
 * getGroupConsoleBacklog()/watchGroupConsole() from lib/groupConsole.ts - themselves just
 * orchestrating the exact same watchLogFile/parseLogChunkWithDate/readLogBacklog this PoC's own
 * console.watch/console.backlog ("The actual headline case") already proved, tagged per-profile
 * and multiplexed over one real serverEvents 'status' subscription that starts/stops each
 * profile's own tailer live as it starts/stops. Also reuses, with zero window.api of their own:
 * useServerStatuses.ts (the hook, from "A fifth real page") and groupConsole.sendRcon (already
 * proven in "A tenth real page"). server.getGameVersion and server.start/stop/restart/update are
 * also already-proven real calls ("A sixth"/"A fifth real page"), just new call sites of them
 * here (the sidebar's version column, and the right-click context menu).
 */
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import GroupConsoleView from '../../src/renderer/src/pages/GroupConsoleView'
import { wrapInvoke } from './lib/tauriInvoke'
import type { GroupConsoleEvent, RconResult, ServerProfile, ServerStatus } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
      event: {
        listen: (
          event: string,
          handler: (event: { payload: unknown }) => void
        ) => Promise<() => void>
      }
    }
    api: {
      server: {
        status: (profileId: string) => Promise<ServerStatus>
        onStatusChanged: (callback: (status: ServerStatus) => void) => () => void
        getGameVersion: (profileId: string) => Promise<string | null>
        start: (profileId: string) => Promise<unknown>
        stop: (profileId: string) => Promise<unknown>
        restart: (profileId: string) => Promise<unknown>
        update: (profileId: string) => Promise<unknown>
      }
      groupConsole: {
        subscribe: (profileIds: string[]) => Promise<GroupConsoleEvent[]>
        unsubscribe: () => Promise<void>
        onEvent: (callback: (event: GroupConsoleEvent) => void) => () => void
        sendRcon: (profileId: string, command: string) => Promise<RconResult>
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)
const { listen } = window.__TAURI__.event

function onEvent<T>(event: string, callback: (payload: T) => void): () => void {
  let unlistenFn: (() => void) | null = null
  let cancelled = false
  listen(event, (e) => callback(e.payload as T)).then((unlisten) => {
    if (cancelled) unlisten()
    else unlistenFn = unlisten
  })
  return () => {
    cancelled = true
    unlistenFn?.()
  }
}

window.api = {
  server: {
    status: (profileId) => invoke('server_status', { profileId }) as Promise<ServerStatus>,
    onStatusChanged: (callback) => onEvent('server-status', callback),
    getGameVersion: (profileId) => invoke('server_get_game_version', { profileId }) as Promise<string | null>,
    start: (profileId) => invoke('server_start', { profileId }),
    stop: (profileId) => invoke('server_stop', { profileId }),
    restart: (profileId) => invoke('server_restart', { profileId }),
    update: (profileId) => invoke('server_update', { profileId })
  },
  groupConsole: {
    subscribe: (profileIds) => invoke('group_console_subscribe', { profileIds }) as Promise<GroupConsoleEvent[]>,
    unsubscribe: () => invoke('group_console_unsubscribe') as Promise<void>,
    onEvent: (callback) => onEvent('group-console-event', callback),
    sendRcon: (profileId, command) =>
      invoke('group_console_rcon_send', { profileId, command }) as Promise<RconResult>
  }
}

function GroupConsolePage(): JSX.Element | null {
  const [profiles, setProfiles] = useState<ServerProfile[] | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => {
      const all = result as ServerProfile[]
      const requestedGroup = new URLSearchParams(window.location.search).get('group')
      const group = requestedGroup ?? all.find((p) => p.group)?.group ?? ''
      setProfiles(all.filter((p) => p.group === group))
    })
  }, [])

  if (!profiles) return null

  return (
    <GroupConsoleView
      groupName={profiles[0]?.group ?? ''}
      profiles={profiles}
      onBack={() => window.history.back()}
      onOpenProfile={(id) => console.log('onOpenProfile (no ServerDetail route in this PoC):', id)}
    />
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('groupconsole.html is missing #root')
createRoot(container).render(<GroupConsolePage />)
