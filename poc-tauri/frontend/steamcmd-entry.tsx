/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/SteamCmdView.tsx - a sixteenth
 * real page. Real, unmodified lib/steamcmdInstaller.ts's installManagedSteamCmd() is the first
 * real OUTBOUND NETWORK call this whole PoC makes - a genuine `fetch()` straight to Valve's own
 * CDN, real bytes to disk, then really extracted. lib/firewall.ts's addFirewallRulesForSteamCmd
 * is real too, and real-honestly platform-gated: it rejects immediately on anything but win32,
 * the exact branch this Linux sandbox exercises - see sidecar.ts's own comment on why
 * forceRefocus() around that call moved to the Rust side (main.rs's
 * steamcmd_add_firewall_rule), since no window handle exists on the sidecar side of this
 * architecture. window.api.dialog.selectFile backs "Browse..." - the same architectural class
 * as dialog_select_directory ("A second real page"), a native dialog with no sidecar
 * involvement.
 */
import { createRoot } from 'react-dom/client'
import SteamCmdView from '../../src/renderer/src/pages/SteamCmdView'
import { wrapInvoke } from './lib/tauriInvoke'
import type { AppSettings } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
    }
    api: {
      settings: {
        get: () => Promise<AppSettings>
        save: (settings: AppSettings) => Promise<AppSettings>
      }
      dialog: {
        selectFile: () => Promise<string | null>
      }
      steamcmd: {
        managedStatus: () => Promise<string | null>
        install: () => Promise<string>
        addFirewallRule: (steamCmdPath: string) => Promise<void>
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)

window.api = {
  settings: {
    get: () => invoke('settings_get') as Promise<AppSettings>,
    save: (settings) => invoke('settings_save', { settings }) as Promise<AppSettings>
  },
  dialog: {
    selectFile: () => invoke('dialog_select_file') as Promise<string | null>
  },
  steamcmd: {
    managedStatus: () => invoke('steamcmd_managed_status') as Promise<string | null>,
    install: () => invoke('steamcmd_install') as Promise<string>,
    addFirewallRule: (steamCmdPath) => invoke('steamcmd_add_firewall_rule', { steamCmdPath }) as Promise<void>
  }
}

const container = document.getElementById('root')
if (!container) throw new Error('steamcmd.html is missing #root')
createRoot(container).render(<SteamCmdView onBack={() => window.history.back()} />)
