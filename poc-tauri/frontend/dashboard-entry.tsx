/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/Dashboard.tsx - the fifth real
 * page in this PoC, and the one that finally closes the "no UI page calls any of this yet" gap
 * the server-process-lifecycle round (see "The actual headline case" below) left open: this is
 * the real Start/Stop/Restart/Kill/Update button bar, wired to the real orchestration layer
 * (lib/serverActions.ts's doStartServer/doStopServer/doRestartServer/doKillServer/
 * doUpdateServer - see sidecar.ts's own comment on why that's a different, more complete real
 * call chain than the server-process round's own direct startServer()/stopServer() calls were),
 * not a simplified stand-in.
 *
 * Dashboard.tsx takes profiles/statuses/maps/staticInfo/installedById/gameVersionById/
 * refreshInstalled as plain props (App.tsx owns and lifts all of that state so it survives
 * Dashboard's own unmount/remount on every server-detail visit - see its own doc comments) -
 * this wrapper is a stand-in for that slice of App.tsx specifically, not for anything inside
 * Dashboard.tsx itself. installedById/gameVersionById/refreshInstalled are deliberately left as
 * empty/no-op here (they only affect the Update button's label and a version string, not the
 * actual action), and showCreateWizard/onOpenProfile are real, working local state/no-ops - this
 * round is scoped to the action buttons and live status display, not the "+ Add Profile" wizard
 * (needs the native folder/file picker - see "A second real page"'s own already-documented
 * native-dialog gap) or the ~26 other pages onOpenProfile would otherwise navigate to.
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Dashboard from '../../src/renderer/src/pages/Dashboard'
import { useServerStatuses } from '../../src/renderer/src/lib/useServerStatuses'
import { wrapInvoke } from './lib/tauriInvoke'
import type { AppSettings, MapDefinition, ServerProfile, ServerStatus, SystemStaticInfo, NetworkUsage } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
      event: {
        listen: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>
      }
    }
    api: {
      settings: {
        get: () => Promise<AppSettings>
        save: (settings: AppSettings) => Promise<AppSettings>
      }
      profiles: {
        save: (profile: ServerProfile) => Promise<ServerProfile[]>
        delete: (id: string) => Promise<ServerProfile[]>
        reorder: (orderedIds: string[]) => Promise<ServerProfile[]>
      }
      server: {
        start: (profileId: string) => Promise<ServerStatus>
        stop: (profileId: string) => Promise<ServerStatus>
        restart: (profileId: string) => Promise<ServerStatus>
        kill: (profileId: string) => Promise<ServerStatus>
        update: (profileId: string) => Promise<void>
        status: (profileId: string) => Promise<ServerStatus>
        onStatusChanged: (callback: (status: ServerStatus) => void) => () => void
      }
      systemStats: {
        getNetworkUsage: () => Promise<NetworkUsage>
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)
const { listen } = window.__TAURI__.event

// Every method here is a thin passthrough to a Tauri command this PoC round added - the same
// shape as every other window.api shim in this PoC, nothing Dashboard.tsx-specific about the
// wiring itself.
window.api = {
  settings: {
    get: () => invoke('settings_get') as Promise<AppSettings>,
    save: (settings) => invoke('settings_save', { settings }) as Promise<AppSettings>
  },
  profiles: {
    save: (profile) => invoke('profiles_save', { profile }) as Promise<ServerProfile[]>,
    delete: (id) => invoke('profiles_delete', { profileId: id }) as Promise<ServerProfile[]>,
    reorder: (orderedIds) => invoke('profiles_reorder', { orderedIds }) as Promise<ServerProfile[]>
  },
  server: {
    start: (profileId) => invoke('server_start', { profileId }) as Promise<ServerStatus>,
    stop: (profileId) => invoke('server_stop', { profileId }) as Promise<ServerStatus>,
    restart: (profileId) => invoke('server_restart', { profileId }) as Promise<ServerStatus>,
    kill: (profileId) => invoke('server_kill', { profileId }) as Promise<ServerStatus>,
    update: (profileId) => invoke('server_update', { profileId }) as Promise<void>,
    status: (profileId) => invoke('server_status', { profileId }) as Promise<ServerStatus>,
    onStatusChanged: (callback) => {
      let unlistenFn: (() => void) | null = null
      let cancelled = false
      listen('server-status', (event) => callback(event.payload as ServerStatus)).then((unlisten) => {
        if (cancelled) unlisten()
        else unlistenFn = unlisten
      })
      return () => {
        cancelled = true
        unlistenFn?.()
      }
    }
  },
  systemStats: {
    getNetworkUsage: () => invoke('system_stats_get_network_usage') as Promise<NetworkUsage>
  }
}

// Same "wait for the real fetch before mounting" fix the ProfileManagementView round applied -
// mounting with an empty `profiles` array that fills in a moment later would be a different
// (and wrong) state than the real App.tsx ever actually shows.
//
// statuses comes from the REAL, unmodified useServerStatuses() hook (lib/useServerStatuses.ts),
// not hand-rolled here - found the hard way: a first version of this wrapper only subscribed to
// the 'server-status' push and started with an empty {} statuses map, same as App.tsx does NOT
// do. That missed a real case the real hook exists specifically to cover: adoptPersistedProcesses
// emits its one-time 'running' status at sidecar startup, before this page's own listener has
// even attached (the sidecar starts well before the webview finishes loading) - so a server
// adopted from a still-alive previous run showed as "stopped" until its next status push, which
// for an already-running server with no monitor tick yet could be indefinitely. useServerStatuses
// avoids exactly this by also pulling window.api.server.status(id) once per profile on mount, the
// same real fix App.tsx already relies on for every one of its own status-consuming pages.
function DashboardPage(): JSX.Element | null {
  const [profiles, setProfiles] = useState<ServerProfile[] | null>(null)
  const [staticInfo, setStaticInfo] = useState<SystemStaticInfo | null>(null)
  const [showCreateWizard, setShowCreateWizard] = useState(false)
  const statuses = useServerStatuses((profiles ?? []).map((p) => p.id))

  useEffect(() => {
    invoke('profiles_list').then((result) => setProfiles(result as ServerProfile[]))
    invoke('system_stats_get_static_info').then((result) => setStaticInfo(result as SystemStaticInfo))

    let unlistenProfiles: (() => void) | null = null
    let cancelled = false
    listen('profiles-changed', (event) => {
      setProfiles(event.payload as ServerProfile[])
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else unlistenProfiles = unlisten
    })
    return () => {
      cancelled = true
      unlistenProfiles?.()
    }
  }, [])

  if (profiles === null) return null
  return (
    <Dashboard
      profiles={profiles}
      onProfilesChange={setProfiles}
      onOpenProfile={(id, tab) => console.log('onOpenProfile (out of scope this round):', id, tab)}
      showCreateWizard={showCreateWizard}
      onOpenCreateWizard={() => setShowCreateWizard(true)}
      onCloseCreateWizard={() => setShowCreateWizard(false)}
      statuses={statuses}
      maps={TEST_MAPS}
      staticInfo={staticInfo}
      installedById={{}}
      gameVersionById={{}}
      refreshInstalled={async () => {}}
    />
  )
}

// Not real map data (lib/games/*.ts's maps.json isn't wired up this round) - just enough for
// mapDisplayName() to resolve the one map id the test profile below actually uses, matching the
// real component's own fallback (the raw id) for every id it doesn't recognize.
const TEST_MAPS: MapDefinition[] = [{ id: 'TheIsland_WP', displayName: 'The Island' }]

const container = document.getElementById('root')
if (!container) throw new Error('dashboard.html is missing #root')
createRoot(container).render(<DashboardPage />)
