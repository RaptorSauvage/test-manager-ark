/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/ManagerLogView.tsx - not a
 * stand-in written for this PoC - against a minimal window.api shim that implements exactly
 * the two methods that one real file calls (managerLog.getLog/onLogChanged), backed by Tauri's
 * invoke/listen instead of Electron's contextBridge-exposed ipcRenderer. Everything else about
 * ManagerLogView - its own state, its own grouping logic, its own JSX, its own className usage -
 * is the real production code, proving the real renderer can run against this architecture, not
 * just that the business logic underneath it can.
 */
import { createRoot } from 'react-dom/client'
import ManagerLogView from '../../src/renderer/src/pages/ManagerLogView'
import { wrapInvoke } from './lib/tauriInvoke'
import type { ManagerLogEntry } from '../../shared/types'

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
      managerLog: {
        getLog: () => Promise<ManagerLogEntry[]>
        onLogChanged: (callback: (entry: ManagerLogEntry) => void) => () => void
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)
const { listen } = window.__TAURI__.event

// This is the entire "port" - the real component's two window.api calls, pointed at the same
// two things this PoC already proved independently (manager_log_get_all / the 'manager-log-
// entry' push event), not new plumbing invented for the React page itself.
window.api = {
  managerLog: {
    getLog: () => invoke('manager_log_get_all') as Promise<ManagerLogEntry[]>,
    onLogChanged: (callback) => {
      let unlistenFn: (() => void) | null = null
      let cancelled = false
      listen('manager-log-entry', (event) => {
        callback(event.payload as ManagerLogEntry)
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

const container = document.getElementById('root')
if (!container) throw new Error('manager-log.html is missing #root')
createRoot(container).render(<ManagerLogView />)
