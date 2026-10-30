/**
 * Every real `window.api` wrapper in this PoC calls `window.__TAURI__.core.invoke(...)`
 * directly and lets its rejection propagate to the real component's own `catch` block
 * unchanged - which, across the whole real renderer, universally assumes the Electron
 * `ipcRenderer.invoke()` convention this app was actually built against: a thrown value is a
 * real `Error` instance, so `(err as Error).message` reads the real text. Tauri's `invoke()`
 * does NOT follow that convention - a Rust command returning `Err(String)` rejects the JS
 * promise with that bare string, not an `Error`. Found by a real `Error`-vs-string mismatch
 * going unnoticed for five real pages across this PoC (see AnalyticsTab's own round in
 * README.md for how this was actually found: a real invoke() rejection confirmed correct at
 * the raw `window.__TAURI__.core.invoke()` level, but the real component's own
 * `{configFolderError && <p>...}` display never appeared, because `(err as Error).message`
 * silently evaluated to `undefined` on a plain string) - every earlier round's error-display
 * UI (Dashboard.tsx's `actionErrors`, ProfileManagementView's import error, ...) has the same
 * latent gap, just never actually exercised and checked on screen before now.
 *
 * Wrapping `invoke` once, here, to normalize a string rejection into a real `Error` is the
 * fix every page's shim should use - a real migration would do this exactly once, at the
 * transport layer, rather than touching every individual catch block in the real renderer.
 */
export function wrapInvoke(
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
): (cmd: string, args?: Record<string, unknown>) => Promise<unknown> {
  return (cmd, args) =>
    invoke(cmd, args).catch((err: unknown) => {
      throw err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err))
    })
}
