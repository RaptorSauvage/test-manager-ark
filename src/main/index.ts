// Must be set before anything queues zlib/fs work on libuv's threadpool. The default
// size (4) is easily saturated by a backup's zip compression alone, which then queues
// up every other async fs/zlib call behind it - including unrelated IPC handlers just
// reading a small JSON file - making the whole app appear frozen ("Not Responding")
// for as long as the backup's zipping takes.
process.env.UV_THREADPOOL_SIZE = '8'

import { app, BrowserWindow, Menu, Tray, shell, dialog } from 'electron'
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
import {
  applyScheduledRestart,
  applyScheduledDinoWipe,
  applyScheduledRconCommands,
  applyScheduledMaintenance
} from './lib/scheduledActions'
import { armAllModEvents } from './lib/modEvents'
import { adoptPersistedProcesses, isRunning, getStatus } from './lib/serverProcess'
import { startMonitoring } from './lib/monitor'
import { registerPlayerBackupWatch, startPlayerBackupWatch } from './lib/playerBackupWatch'
import { registerPlayerJoinAlertWatch, startPlayerJoinAlertWatch } from './lib/playerJoinAlertWatch'
import { registerDiscordChatBridgeWatch, startDiscordChatBridgeWatch } from './lib/discordChatBridgeWatch'
import { registerPlayerActivityWatch, startPlayerActivityWatch } from './lib/playerActivityWatch'
import { startUpdateCheckPolling } from './lib/updateCheck'
import { applyLaunchOnStartup } from './lib/launchOnStartup'
import { doStartServer, doStopServer, doKillServer } from './lib/serverActions'
import { runAutoStart } from './lib/autoStart'
import { registerServerVersionWatcher, checkAllGameVersionsOnStartup } from './lib/serverVersionWatcher'
import { registerIniLockWatcher, unlockStoppedProfilesOnStartup, applyIniLockSetting } from './lib/iniLock'
import { registerCrashWatch } from './lib/crashWatch'
import { registerZombieDetection } from './lib/zombieDetection'
import { registerClusterLogArchiveWatch, startClusterLogArchiveWatch } from './lib/clusterLogArchive'
import { doStartMinecraftServer, doStopMinecraftServer } from './lib/minecraftActions'
import {
  adoptPersistedMinecraftProcesses,
  isRunning as isMinecraftRunning,
  getStatus as getMinecraftStatus
} from './lib/minecraftProcess'
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

/** Stops every currently-running ARK and Minecraft server, confirmed first since this kicks
 *  every connected player off every server at once - a much bigger blast radius than the
 *  Dashboard's own per-server Stop button, which only ever needs a confirm for one server
 *  at a time (confirmAction in the renderer; this runs in the main process, off its own
 *  window entirely, so it needs Electron's own dialog instead). */
async function stopAllServers(): Promise<void> {
  const arkRunning = listProfiles().filter((p) => isRunning(p.id))
  const mcRunning = listMinecraftProfiles().filter((p) => isMinecraftRunning(p.id))
  const total = arkRunning.length + mcRunning.length
  if (total === 0) return

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Annuler', 'Tout arrêter'],
    defaultId: 0,
    cancelId: 0,
    message: `Arrêter les ${total} serveur${total > 1 ? 's' : ''} en cours ?`,
    detail: 'Tous les joueurs connectés seront déconnectés.'
  })
  if (response !== 1) return

  await Promise.all([
    ...arkRunning.map((p) => doStopServer(p).catch((err) => console.error(`Stop all - ${p.name} failed:`, err))),
    ...mcRunning.map((p) =>
      doStopMinecraftServer(p).catch((err) => console.error(`Stop all - ${p.name} failed:`, err))
    )
  ])
}

/** Rebuilt fresh on every open (see createTray/the refresh timer below) rather than once -
 *  the running counts/players/CPU/RAM lines would otherwise go stale the moment any server
 *  starts, stops, or a player joins/leaves while the tray's just sitting there. */
function buildTrayMenu(): Menu {
  const arkProfiles = listProfiles()
  const mcProfiles = listMinecraftProfiles()
  const arkRunning = arkProfiles.filter((p) => isRunning(p.id))
  const mcRunning = mcProfiles.filter((p) => isMinecraftRunning(p.id))
  const arkStatuses = arkRunning.map((p) => getStatus(p.id))
  const mcStatuses = mcRunning.map((p) => getMinecraftStatus(p.id))
  const totalPlayers =
    arkStatuses.reduce((sum, s) => sum + (s.players?.length ?? 0), 0) +
    mcStatuses.reduce((sum, s) => sum + (s.players?.length ?? 0), 0)
  const totalCpu =
    arkStatuses.reduce((sum, s) => sum + (s.cpu ?? 0), 0) + mcStatuses.reduce((sum, s) => sum + (s.cpu ?? 0), 0)
  const totalMemoryMB =
    arkStatuses.reduce((sum, s) => sum + (s.memoryMB ?? 0), 0) +
    mcStatuses.reduce((sum, s) => sum + (s.memoryMB ?? 0), 0)

  return Menu.buildFromTemplate([
    { label: `ARK : ${arkRunning.length}/${arkProfiles.length} en cours`, enabled: false },
    { label: `Minecraft : ${mcRunning.length}/${mcProfiles.length} en cours`, enabled: false },
    { label: `Joueurs : ${totalPlayers}`, enabled: false },
    { label: `CPU : ${totalCpu.toFixed(1)}% · RAM : ${totalMemoryMB} Mo`, enabled: false },
    { type: 'separator' },
    { label: 'Ouvrir Bober Server Manager', click: showAndFocusMainWindow },
    { type: 'separator' },
    {
      label: 'Tout arrêter',
      enabled: arkRunning.length + mcRunning.length > 0,
      click: () => void stopAllServers()
    },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() }
  ])
}

function createTray(): void {
  tray = new Tray(iconPath)
  tray.setToolTip('Bober Server Manager')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', showAndFocusMainWindow)
  // No 'right-click' event to hook on Linux (Electron only emits it on Windows/macOS), so a
  // short interval rebuild is what keeps the menu's counts fresh everywhere instead - cheap
  // (in-memory store reads only) and only runs once the tray actually exists.
  setInterval(() => {
    if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu())
  }, 5000)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    icon: iconPath,
    // No OS title bar - the renderer draws its own (src/renderer/src/components/TitleBar.tsx),
    // styled like the rest of the app instead of whatever the OS theme looks like. Its
    // minimize/maximize/close buttons go through the windowControls IPC in
    // src/main/ipc/windowControls.ts.
    frame: false,
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
  registerPlayerJoinAlertWatch()
  registerPlayerActivityWatch()
  registerDiscordChatBridgeWatch()
  applyWebDashboardSettings(getSettings())
  void applyDiscordBotSettings(getSettings())
  applyLaunchOnStartup(getSettings())
  startUpdateCheckPolling()

  for (const profile of profiles) {
    applyBackupSchedule(profile)
    applyScheduledRestart(profile)
    applyScheduledDinoWipe(profile)
    applyScheduledRconCommands(profile)
    applyScheduledMaintenance(profile)
    if (isRunning(profile.id)) {
      startMonitoring(profile)
      startPlayerBackupWatch(profile)
      startPlayerJoinAlertWatch(profile)
      startPlayerActivityWatch(profile)
      startClusterLogArchiveWatch(profile)
      startDiscordChatBridgeWatch(profile)
    }
  }

  // Event Scheduler - cluster-wide, not per-profile, so armed once rather than inside the
  // loop above. Also reconciles each event's mods right now (see armModEvent's own doc
  // comment), so a Manager that was closed through an event's start/end still ends up
  // correct immediately instead of waiting for the next occurrence.
  armAllModEvents()

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
