import type { BrowserWindow } from 'electron'

/**
 * Forces the renderer to actually regain keyboard focus after a native modal closes
 * (window.confirm()/window.alert(), the file/folder pickers, a UAC prompt) - a known
 * Electron/Windows issue where the window looks normal afterward but every text field
 * silently stops accepting keystrokes until it's explicitly refocused.
 *
 * `mainWindow.focus()` plus `mainWindow.webContents.focus()` alone turned out not to be
 * enough on a real repro: document.hasFocus() stayed false afterward even though both were
 * called. What reliably fixed it for the user was alt-tabbing away and back - a real OS-level
 * foreground-window change - which is consistent with Windows' anti-focus-stealing
 * protection (SetForegroundWindow can silently no-op for a background process reclaiming
 * focus on its own, even its own window). minimize()+restore() forces the same kind of
 * genuine foreground transition programmatically, same as the user's own workaround.
 */
export function forceRefocus(mainWindow: BrowserWindow): void {
  if (mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  else {
    mainWindow.minimize()
    mainWindow.restore()
  }
  mainWindow.focus()
  mainWindow.webContents.focus()
}
