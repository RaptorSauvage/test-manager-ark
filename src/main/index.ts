// Must be set before anything queues zlib/fs work on libuv's threadpool. The default
// size (4) is easily saturated by a backup's zip compression alone, which then queues
// up every other async fs/zlib call behind it - including unrelated IPC handlers just
// reading a small JSON file - making the whole app appear frozen ("Not Responding")
// for as long as the backup's zipping takes.
process.env.UV_THREADPOOL_SIZE = '8'

import { app, BrowserWindow, Menu, Tray, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import {
  listProfiles,
  getRunningPids,
  getRunningStartedAt,
  getSettings,
  getProfile,
  listMinecraftProfiles,
  getMinecraftRunningPids,
  getMinecraftRunningStartedAt
} from './store'
import { applyWebDashboardSettings } from './lib/webDashboard'
import { applyDiscordBotSettings } from './lib/discordBot'
import { applyBackupSchedule, registerBackupScheduleWatcher } from './lib/schedule'
import { applyScheduledRestart, applyScheduledDinoWipe } from './lib/scheduledActions'
import { adoptPersistedProcesses, isRunning } from './lib/serverProcess'
import { startMonitoring } from './lib/monitor'
import { registerPlayerBackupWatch, startPlayerBackupWatch } from './lib/playerBackupWatch'
import { startUpdateCheckPolling } from './lib/updateCheck'
import { applyLaunchOnStartup } from './lib/launchOnStartup'
import { doStartServer, doKillServer } from './lib/serverActions'
import { runAutoStart } from './lib/autoStart'
import { registerServerVersionWatcher, checkAllGameVersionsOnStartup } from './lib/serverVersionWatcher'
import { registerIniLockWatcher, unlockStoppedProfilesOnStartup, applyIniLockSetting } from './lib/iniLock'
import { registerCrashWatch } from './lib/crashWatch'
import { registerZombieDetection } from './lib/zombieDetection'
import { registerClusterLogArchiveWatch, startClusterLogArchiveWatch } from './lib/clusterLogArchive'
import { doStartMinecraftServer } from './lib/minecraftActions'
import { adoptPersistedMinecraftProcesses, isRunning as isMinecraftRunning } from './lib/minecraftProcess'
import { startMinecraftMonitoring } from './lib/minecraftMonitor'
import { applyMinecraftScheduledRestart } from './lib/minecraftScheduledActions'
import { applyMinecraftBackupSchedule, registerMinecraftBackupScheduleWatcher } from './lib/minecraftBackupSchedule'

// Electron apps that only hide (not quit) when their window closes - see "close to tray"
// below - make it very easy to end up with a second instance running invisibly in the
// background without realizing the first one is still alive (confirmed as a real report:
// Chromium GPU cache errors from two processes fighting over the same userData folder, and
// two Discord bot child processes connected to the same token at once). requestSingleInstanceLock
// makes a second launch immediately quit itself and instead signal the first instance (via
// 'second-instance' below) to show/focus its window - must run before anything else that
// could matter if this turns out to be the second instance.
// A hard, synchronous exit rather than app.quit() - nothing (no window, no IPC, no server
// processes) has been set up yet in this doomed second instance, and app.quit() only
// schedules a quit, which would let the rest of this file's side effects (adopting
// persisted server processes, starting the web dashboard, spawning the Discord bot...) run
// at least once before it actually took effect.
if (!app.requestSingleInstanceLock()) {
  process.exit(0)
}

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

// No File/Edit/View/Window/Help needed for this app - it's not a document editor, and this
// bar was never intentionally set up, just Electron's unremoved default.
Menu.setApplicationMenu(null)

const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../build/icon.png')

// Set once quit was actually requested (tray "Quit", OS shutdown, etc.) - 'before-quit'
// always fires before Electron tries to close any window, so by the time the window's own
// 'close' handler below runs, this already reflects whether it's a real quit or just the
// user clicking the window's close button. Without it, "close to tray" would have no way
// to tell the two apart and could never actually quit at all.
let isQuitting = false
app.on('before-quit', () => {
  isQuitting = true
})

let tray: Tray | null = null
// Tracks the one window this single-instance-locked app ever has, so a second launch
// attempt (see 'second-instance' below) and the tray's own "Ouvrir" can both reach it.
let mainWindowRef: BrowserWindow | null = null

function showAndFocusMainWindow(): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return
  mainWindowRef.show()
  mainWindowRef.focus()
}

app.on('second-instance', showAndFocusMainWindow)

function createTray(): void {
  tray = new Tray(iconPath)
  tray.setToolTip('Bober Server Manager')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir Bober Server Manager', click: showAndFocusMainWindow },
      { type: 'separator' },
      { label: 'Quitter', click: () => app.quit() }
    ])
  )
  tray.on('click', showAndFocusMainWindow)
}

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
  mainWindowRef = mainWindow

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // "Close to tray" (Settings > Startup & Safety) - checked fresh on every close instead of
  // once at startup, so toggling the setting while the app is running takes effect on the
  // very next close rather than needing a restart. Every managed server tracks its own
  // process independently of this window (see serverProcess.ts), so hiding instead of
  // quitting doesn't touch them - only the window itself, plus whatever's riding along in
  // this same process (the web dashboard, the Discord bot's supervisor).
  mainWindow.on('close', (event) => {
    if (isQuitting || !getSettings().closeToTrayEnabled) return
    event.preventDefault()
    mainWindow.hide()
  })

  if (!tray) createTray()

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
  registerBackupScheduleWatcher()
  registerMinecraftBackupScheduleWatcher()
  registerCrashWatch(doStartServer)
  registerZombieDetection(doKillServer, doStartServer)
  registerClusterLogArchiveWatch(getProfile)

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
  void applyDiscordBotSettings(getSettings())
  applyLaunchOnStartup(getSettings())
  startUpdateCheckPolling()

  for (const profile of profiles) {
    applyBackupSchedule(profile)
    applyScheduledRestart(profile)
    applyScheduledDinoWipe(profile)
    if (isRunning(profile.id)) {
      startMonitoring(profile)
      startPlayerBackupWatch(profile)
      startClusterLogArchiveWatch(profile)
    }
  }

  runAutoStart(profiles, getSettings().serverAutoStartStaggerSeconds, isRunning, doStartServer)

  const minecraftProfiles = listMinecraftProfiles()

  // Re-attach to Minecraft servers still running from a previous session - same reasoning
  // as ARK's own adoptPersistedProcesses above.
  adoptPersistedMinecraftProcesses(minecraftProfiles, getMinecraftRunningPids(), getMinecraftRunningStartedAt())

  for (const profile of minecraftProfiles) {
    applyMinecraftScheduledRestart(profile)
    applyMinecraftBackupSchedule(profile)
    if (isMinecraftRunning(profile.id)) startMinecraftMonitoring(profile)
  }

  const minecraftStaggerMs = Math.max(0, getSettings().serverAutoStartStaggerSeconds) * 1000
  minecraftProfiles
    .filter((profile) => profile.startOnManagerLaunch && !isMinecraftRunning(profile.id))
    .forEach((profile, index) => {
      setTimeout(
        () => {
          try {
            doStartMinecraftServer(profile)
          } catch (err) {
            console.error(`Auto-start failed for Minecraft profile ${profile.name}:`, (err as Error).message)
          }
        },
        (index + 1) * minecraftStaggerMs
      )
    })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
