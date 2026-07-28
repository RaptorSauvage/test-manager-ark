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

  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ state: 'downloaded', version: info.version })
    autoUpdater.quitAndInstall()
  })

  autoUpdater.on('error', (err: Error) => setStatus({ state: 'error', error: err.message }))
}

/**
 * Checks this repo's GitHub Releases for a newer version, downloads it, and installs it
 * (quitting and relaunching the app) once ready - the whole flow behind a single Settings
 * button, with progress pushed via appUpdateEvents along the way. A no-op outside a
 * packaged build, since there's no update feed (app-update.yml) to read from in dev.
 */
export function checkForUpdateAndInstall(): void {
  if (!app.isPackaged) {
    setStatus({ state: 'error', error: 'Update checks only work in a packaged build, not in dev.' })
    return
  }
  wireAutoUpdater()
  setStatus({ state: 'checking' })
  autoUpdater.checkForUpdates().catch((err: Error) => setStatus({ state: 'error', error: err.message }))
}
