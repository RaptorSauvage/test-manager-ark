import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateStatus } from '@shared/types'

export const appUpdateEvents = new EventEmitter()

let currentStatus: AppUpdateStatus = { state: 'idle' }

function setStatus(status: AppUpdateStatus): void {
  currentStatus = status
  appUpdateEvents.emit('status', status)
}

export function getAppUpdateStatus(): AppUpdateStatus {
  return currentStatus
}

let wired = false

/** Wires autoUpdater's events into our own status object exactly once - this module is
 *  imported long before any check happens (IPC registration at app startup), but the
 *  listeners only need attaching once regardless of how many checks are run afterwards. */
function wireAutoUpdater(): void {
  if (wired) return
  wired = true

  // We drive the download ourselves (right after 'update-available') rather than using
  // autoUpdater's own autoDownload, so the whole check -> download -> install sequence is
  // one continuous flow behind a single button, with our own status pushed at each step.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }))

  autoUpdater.on('update-available', (info) => {
    setStatus({ state: 'available', version: info.version })
    autoUpdater.downloadUpdate().catch((err: Error) => setStatus({ state: 'error', error: err.message }))
  })

  autoUpdater.on('update-not-available', () => setStatus({ state: 'not-available' }))

  autoUpdater.on('download-progress', (progress) => {
    setStatus({ state: 'downloading', version: currentStatus.version, percent: Math.round(progress.percent) })
  })

  // Deliberately does NOT call quitAndInstall() here - it used to, and would silently
  // quit the app the instant a download finished, with no warning. That's a real way to
  // lose unsaved work elsewhere in the app (e.g. a Settings field typed but not yet
  // saved), since the quit happens underneath whatever the user is doing. Instead we
  // just report "downloaded" and wait for an explicit installDownloadedUpdate() call.
  autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'downloaded', version: info.version }))

  autoUpdater.on('error', (err: Error) => setStatus({ state: 'error', error: err.message }))
}

/**
 * Checks this repo's GitHub Releases for a newer version and downloads it if found - the
 * check-and-download half of the flow, with progress pushed via appUpdateEvents along the
 * way. A no-op outside a packaged build, since there's no update feed (app-update.yml) to
 * read from in dev. Once the status reaches 'downloaded', call installDownloadedUpdate()
 * to actually quit and install - kept as a separate explicit step on purpose.
 */
export function checkForUpdate(): void {
  if (!app.isPackaged) {
    setStatus({ state: 'error', error: 'Update checks only work in a packaged build, not in dev.' })
    return
  }
  wireAutoUpdater()
  setStatus({ state: 'checking' })
  autoUpdater.checkForUpdates().catch((err: Error) => setStatus({ state: 'error', error: err.message }))
}

/** Quits and installs an already-downloaded update - only meaningful once the status is
 *  'downloaded'. Kept as its own explicit call so the app never restarts on its own. */
export function installDownloadedUpdate(): void {
  autoUpdater.quitAndInstall()
}
