import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { listProfiles, getRunningPids } from './store'
import { applyBackupSchedule } from './lib/schedule'
import { applyScheduledRestart, applyScheduledDinoWipe } from './lib/scheduledActions'
import { adoptPersistedProcesses, isRunning } from './lib/serverProcess'
import { startMonitoring } from './lib/monitor'
import { registerPlayerBackupWatch, startPlayerBackupWatch } from './lib/playerBackupWatch'
import { registerLogEventCapture, startLogEventCapture } from './lib/logEvents'

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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
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

  // Re-attach to servers still running from a previous session (they survive
  // this app crashing/closing by design - see serverProcess.startServer).
  adoptPersistedProcesses(profiles, getRunningPids())
  registerPlayerBackupWatch()
  registerLogEventCapture()

  for (const profile of profiles) {
    applyBackupSchedule(profile)
    applyScheduledRestart(profile)
    applyScheduledDinoWipe(profile)
    if (isRunning(profile.id)) {
      startMonitoring(profile)
      startPlayerBackupWatch(profile)
      startLogEventCapture(profile)
    }
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
