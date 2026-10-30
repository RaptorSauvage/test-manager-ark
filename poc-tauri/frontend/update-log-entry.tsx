/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/ServerDetail/UpdateLogTab.tsx -
 * an eighth real page, and the smallest one this PoC has ported (52 lines). Real, unmodified
 * readUpdateLog() - the read side of lib/steamcmd.ts's own per-profile update-run log file,
 * written by the real updateServer() this PoC's server.update already calls. In this sandbox
 * that write never happens (updateServer() fails fast with no real SteamCMD installed, before
 * ever creating the log file), so the honest real-code result is "No update log yet" every
 * time - same category of gap as AnalyticsTab's UpdateCheckPanel. A test-only
 * steamcmd.appendTestUpdateLogLine (writes straight to the real log path and emits the real
 * steamcmdUpdateEvents 'log' event) stands in for a real update run, the same way
 * console.appendTestLine/server.installTestExecutable do elsewhere in this PoC, so the live
 * onUpdateLogChanged push path can still be proven without one.
 */
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import UpdateLogTab from '../../src/renderer/src/pages/ServerDetail/UpdateLogTab'
import { wrapInvoke } from './lib/tauriInvoke'
import type { ServerProfile } from '../../shared/types'

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
      steamcmd: {
        getUpdateLog: (profileId: string) => Promise<string | null>
        onUpdateLogChanged: (callback: (profileId: string) => void) => () => void
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)
const { listen } = window.__TAURI__.event

window.api = {
  steamcmd: {
    getUpdateLog: (profileId) => invoke('steamcmd_get_update_log', { profileId }) as Promise<string | null>,
    onUpdateLogChanged: (callback) => {
      let unlistenFn: (() => void) | null = null
      let cancelled = false
      listen('steamcmd-update-log-changed', (event) => {
        callback(event.payload as string)
      }).then((unlisten) => {
        if (cancelled) unlisten()
        else unlistenFn = unlisten
      })
      return () => {
        cancelled = true
        unlistenFn?.()
      }
    }
  }
}

function UpdateLogPage(): JSX.Element | null {
  const [profile, setProfile] = useState<ServerProfile | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => {
      const profiles = result as ServerProfile[]
      const requestedId = new URLSearchParams(window.location.search).get('profile')
      setProfile(profiles.find((p) => p.id === requestedId) ?? profiles[0] ?? null)
    })
  }, [])

  if (!profile) return null

  return <UpdateLogTab profile={profile} />
}

const container = document.getElementById('root')
if (!container) throw new Error('update-log.html is missing #root')
createRoot(container).render(<UpdateLogPage />)
