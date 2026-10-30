/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/ServerDetail/AnalyticsTab.tsx -
 * a sixth real page, and the first to pull together five real subsystems this PoC hadn't
 * touched until now: lib/statsHistory.ts (persisted CPU/RAM/player history, the read side of
 * what monitor.ts's recordStatSample already writes - see "A fifth real page" above),
 * lib/schedule.ts's getBackupScheduleStatus (the Backup Status panel), lib/steamcmd.ts's
 * getInstalledBuildId and lib/serverVersion.ts's getGameVersion (mirroring the real
 * ipc/serverProcess.ts handlers exactly), lib/updateCheck.ts's getLatestBuildIdCache (a pure
 * cache read backing UpdateCheckPanel), and three more lib/systemFolders.ts functions (the same
 * shell.openPath round trip openProfilesFolder already proved). None of them are Electron-coupled.
 *
 * Found and fixed a real wiring gap building this: lib/schedule.ts's own
 * serverEvents.on('status', ...) subscription is NOT a module-load side effect like every other
 * push source in this PoC - it only happens once registerBackupScheduleWatcher() is actually
 * called (see sidecar.ts's own comment on this), the same real index.ts startup-order
 * requirement adoptPersistedProcesses already has.
 *
 * Also found a second, bigger gap here: clicking "INI Config" with no real config folder on
 * disk correctly reached the real, unmodified `openServerConfigFolder()` and correctly
 * rejected with its real error string - confirmed directly against `window.__TAURI__.core
 * .invoke()` - but the real component's own `{configFolderError && <p>...}` display never
 * appeared. Root cause: Tauri's `invoke()` rejects with a bare string, not an `Error` instance
 * the way Electron's `ipcRenderer.invoke()` does, so the real code's `(err as Error).message`
 * silently read `undefined`. See `./lib/tauriInvoke.ts` for the fix (applied to every entry
 * file in this PoC, not just this one) and README.md for the full writeup.
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import AnalyticsTab from '../../src/renderer/src/pages/ServerDetail/AnalyticsTab'
import { wrapInvoke } from './lib/tauriInvoke'
import type { BackupScheduleStatus, LatestBuildIdCache, ServerProfile, ServerStatus, StatSample } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
      event: {
        listen: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>
      }
    }
    api: {
      server: {
        status: (profileId: string) => Promise<ServerStatus>
        onStatusChanged: (callback: (status: ServerStatus) => void) => () => void
        getInstalledBuildId: (profileId: string) => Promise<string | null>
        getGameVersion: (profileId: string) => Promise<string | null>
      }
      profiles: {
        save: (profile: ServerProfile) => Promise<ServerProfile[]>
      }
      backup: {
        getScheduleStatus: (profileId: string) => Promise<BackupScheduleStatus>
      }
      statsHistory: {
        get: (profileId: string, sinceMs: number | null, maxPoints?: number) => Promise<StatSample[]>
      }
      system: {
        openServerConfigFolder: (profileId: string) => Promise<void>
        openServerSavedArksFolder: (profileId: string) => Promise<void>
        openServerSaveGamesFolder: (profileId: string) => Promise<void>
      }
      steamcmd: {
        getLatestBuildId: (game: string, branch?: string) => Promise<LatestBuildIdCache>
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)
const { listen } = window.__TAURI__.event

window.api = {
  server: {
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
    },
    getInstalledBuildId: (profileId) => invoke('server_get_installed_build_id', { profileId }) as Promise<string | null>,
    getGameVersion: (profileId) => invoke('server_get_game_version', { profileId }) as Promise<string | null>
  },
  profiles: {
    save: (profile) => invoke('profiles_save', { profile }) as Promise<ServerProfile[]>
  },
  backup: {
    getScheduleStatus: (profileId) => invoke('backup_get_schedule_status', { profileId }) as Promise<BackupScheduleStatus>
  },
  statsHistory: {
    get: (profileId, sinceMs, maxPoints) =>
      invoke('stats_history_get', { profileId, sinceMs, maxPoints }) as Promise<StatSample[]>
  },
  system: {
    openServerConfigFolder: (profileId) => invoke('system_open_server_config_folder', { profileId }) as Promise<void>,
    openServerSavedArksFolder: (profileId) => invoke('system_open_server_saved_arks_folder', { profileId }) as Promise<void>,
    openServerSaveGamesFolder: (profileId) => invoke('system_open_server_save_games_folder', { profileId }) as Promise<void>
  },
  steamcmd: {
    getLatestBuildId: (game, branch) =>
      invoke('steamcmd_get_latest_build_id', { game, branch }) as Promise<LatestBuildIdCache>
  }
}

// AnalyticsTab takes one specific profile, not a list - this wrapper fetches the real profiles
// and picks the one whose id matches a query param (?profile=<id>), falling back to the first
// one, instead of hardcoding a single profile id into the page the way earlier rounds' simplest
// wrappers did.
function AnalyticsPage(): JSX.Element | null {
  const [profile, setProfile] = useState<ServerProfile | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => {
      const profiles = result as ServerProfile[]
      const wanted = new URLSearchParams(window.location.search).get('profile')
      setProfile(profiles.find((p) => p.id === wanted) ?? profiles[0] ?? null)
    })
  }, [])

  if (profile === null) return null
  return <AnalyticsTab profile={profile} onProfileChange={setProfile} />
}

const container = document.getElementById('root')
if (!container) throw new Error('analytics.html is missing #root')
createRoot(container).render(<AnalyticsPage />)
