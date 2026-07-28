import { app } from 'electron'
import type { AppSettings } from '@shared/types'

/** Registers (or unregisters) this app to launch at login, matching the stored setting -
 *  via Electron's own login-item API (Windows/macOS; Linux support depends on the
 *  Electron version). Wrapped in try/catch since a portable/unpackaged build or an
 *  unsupported environment shouldn't crash the app over this. */
export function applyLaunchOnStartup(settings: AppSettings): void {
  try {
    app.setLoginItemSettings({ openAtLogin: settings.launchOnStartup })
  } catch (err) {
    console.error('Failed to apply launch-on-startup setting:', (err as Error).message)
  }
}
