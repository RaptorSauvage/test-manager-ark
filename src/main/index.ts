// Must be set before anything queues zlib/fs work on libuv's threadpool. The default
// size (4) is easily saturated by a backup's zip compression alone, which then queues
// up every other async fs/zlib call behind it - including unrelated IPC handlers just
// reading a small JSON file - making the whole app appear frozen ("Not Responding")
// for as long as the backup's zipping takes.
process.env.UV_THREADPOOL_SIZE = '8'

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { listProfiles, getRunningPids, getRunningStartedAt, getSettings } from './store'
import { applyWebDashboardSettings } from './lib/webDashboard'
import { applyBackupSchedule } from './lib/schedule'
import { applyScheduledRestart, applyScheduledDinoWipe } from './lib/scheduledActions'
import { adoptPersistedProcesses, isRunning } from './lib/serverProcess'
import { startMonitoring } from './lib/monitor'
import { registerPlayerBackupWatch, startPlayerBackupWatch } from './lib/playerBackupWatch'
import { startUpdateCheckPolling } from './lib/updateCheck'
import { applyLaunchOnStartup } from './lib/launchOnStartup'
import { doStartServer } from './lib/serverActions'
import { runAutoStart } from './lib/autoStart'
import { registerServerVersionWatcher, checkAllGameVersionsOnStartup } from './lib/serverVersionWatcher'
import { registerIniLockWatcher, unlockStoppedProfilesOnStartup, applyIniLockSetting } from './lib/iniLock'

// Network hiccups (RCON connection resets, SteamCMD downloads, etc.) can surface
// as errors/rejections that slip past local try/catch - e.g. rcon-client re-emits
// socket errors on its own EventEmitter, which crashes the whole process by
// default if unhandled. Log and keep running instead of taking down the app
// (and, with it, tracking of any server it's managing) over a transient error.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in main process:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection in main process:', reason)
})

const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../build/icon.png')

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  registerIpcHandlers(mainWindow)

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const profiles = listProfiles()

  // Registered before adoption below, so it catches the running-status broadcast that
  // emits for an already-running adopted server too, not just a fresh start.
  registerServerVersionWatcher()
  registerIniLockWatcher()

  // Re-attach to servers still running from a previous session (they survive
  // this app crashing/closing by design - see serverProcess.startServer).
  adoptPersistedProcesses(profiles, getRunningPids(), getRunningStartedAt())

  // Every profile, not just running ones - a stopped server's log from its last run may
  // still have a usable version line, no reason to wait for its next start to show one.
  checkAllGameVersionsOnStartup(profiles)

  // Safety net for a previous crash/force-quit that left a running server's config files
  // locked read-only - anything not currently running gets unlocked once, right away.
  unlockStoppedProfilesOnStartup(profiles, isRunning)
  // If the feature is currently disabled, also unlock anything still running right now -
  // covers the setting having been turned off since the Manager last ran.
  applyIniLockSetting(getSettings().iniLockEnabled, profiles)

  registerPlayerBackupWatch()
  applyWebDashboardSettings(getSettings())
  applyLaunchOnStartup(getSettings())
  startUpdateCheckPolling()

  for (const profile of profiles) {
    applyBackupSchedule(profile)
    applyScheduledRestart(profile)
    applyScheduledDinoWipe(profile)
    if (isRunning(profile.id)) {
      startMonitoring(profile)
      startPlayerBackupWatch(profile)
    }
  }

  runAutoStart(profiles, getSettings().serverAutoStartStaggerSeconds, isRunning, doStartServer)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
