/**
 * PoC-only stand-in for the subset of Electron's `app` module that main/store.ts (via
 * electron-store) and lib/dataDir.ts actually touch. Bundled in place of the real 'electron'
 * module (see build.mjs's esbuild alias) so this sidecar can run as a plain Node child process
 * instead of inside Electron's own runtime - this is exactly the kind of small decoupling
 * point a real Tauri migration would need everywhere Electron APIs leak into business logic;
 * surfacing it cheaply here (two methods, one file) is the actual point of this PoC, not
 * something to treat as finished infrastructure.
 */
import os from 'node:os'
import path from 'node:path'

const POC_USER_DATA = path.join(os.homedir(), '.tauri-poc-bober-manager')

export const app = {
  getPath(name: string): string {
    if (name === 'userData') return POC_USER_DATA
    if (name === 'documents') return path.join(os.homedir(), 'Documents')
    throw new Error(`electronShim.app.getPath: unhandled path name "${name}" - add it if the sidecar needs it`)
  },
  isPackaged: false
}
