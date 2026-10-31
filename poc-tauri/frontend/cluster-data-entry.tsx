/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/ClusterDataView.tsx - a
 * fifteenth real page, the "Cluster Dashboard" showing merged per-group CPU/RAM/player totals
 * plus a history chart. Reuses two real, unmodified pieces this PoC already proved need no
 * window.api of their own: useServerStatuses.ts (the hook, from "A fifth real page"'s
 * dashboard-entry.tsx) and ServerStatsChart.tsx (pure SVG, from "A sixth real page"'s
 * AnalyticsTab). The one new real call: readClusterStatsHistoryForGroups, the
 * read-every-group-at-once sibling of readStatsHistory. `onOpenGroup` has no real page to open
 * yet in this PoC (GroupConsoleView.tsx isn't ported) - logs to the console instead of
 * navigating, honestly short of the real app's own behavior rather than faking it.
 */
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import ClusterDataView from '../../src/renderer/src/pages/ClusterDataView'
import { wrapInvoke } from './lib/tauriInvoke'
import type { AppSettings, ServerProfile, ServerStatus, StatSample } from '../../shared/types'

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
      settings: {
        get: () => Promise<AppSettings>
      }
      server: {
        status: (profileId: string) => Promise<ServerStatus>
        onStatusChanged: (callback: (status: ServerStatus) => void) => () => void
      }
      statsHistory: {
        getForGroups: (
          groupProfileIds: Record<string, string[]>,
          sinceMs: number | null,
          maxPoints?: number
        ) => Promise<Record<string, StatSample[]>>
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
  settings: {
    get: () => invoke('settings_get') as Promise<AppSettings>
  },
  server: {
    status: (profileId) => invoke('server_status', { profileId }) as Promise<ServerStatus>,
    onStatusChanged: (callback) => onEvent('server-status', callback)
  },
  statsHistory: {
    getForGroups: (groupProfileIds, sinceMs, maxPoints) =>
      invoke('stats_history_get_for_groups', { groupProfileIds, sinceMs, maxPoints }) as Promise<
        Record<string, StatSample[]>
      >
  }
}

function ClusterDataPage(): JSX.Element | null {
  const [profiles, setProfiles] = useState<ServerProfile[] | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => setProfiles(result as ServerProfile[]))
  }, [])

  if (!profiles) return null

  return (
    <ClusterDataView
      profiles={profiles}
      onOpenGroup={(groupName) => console.log('onOpenGroup (no GroupConsoleView in this PoC):', groupName)}
    />
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('cluster-data.html is missing #root')
createRoot(container).render(<ClusterDataPage />)
