/**
 * Drop-in replacement for the browser's own `confirm()` - in Electron, `window.confirm()`
 * is a real native OS dialog, not an in-page one, and closing it can leave the main window
 * without OS-level keyboard focus (a known Electron/Windows quirk). When that happens, every
 * text field afterward still looks normal - not disabled, still visually focusable - but
 * silently stops accepting keystrokes until the window is explicitly refocused. Reported as
 * "I can interact with a field once, then never again, all over the app."
 *
 * Always call this instead of the bare `confirm(...)` for any destructive-action prompt.
 */
export function confirmAction(message: string): boolean {
  const result = window.confirm(message)
  void window.api.system.focusWindow()
  return result
}
