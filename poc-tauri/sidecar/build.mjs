// Bundles sidecar.ts (which imports the REAL src/main/store.ts unmodified) into a single
// standalone CJS file the Rust shell can spawn with plain `node dist/sidecar.cjs` - no
// `npm install` needed next to it, and 'electron' is aliased to electronShim.ts so the bundle
// never tries to load the real (Electron-runtime-only) 'electron' module.
import * as esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

await esbuild.build({
  entryPoints: [path.join(here, 'sidecar.ts')],
  outfile: path.join(here, 'dist', 'sidecar.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // Real lib files (serverProcess.ts, logEvents.ts, ...) use the project's own "@shared/*"
  // tsconfig path alias, which esbuild doesn't resolve on its own - found by actually trying
  // to bundle them, not from reading esbuild's docs first. Pointing esbuild at the real
  // tsconfig (rather than re-declaring the mapping here by hand) reuses the project's own
  // source of truth instead of a second copy that could drift from it.
  tsconfig: path.join(here, '../../tsconfig.node.json'),
  alias: {
    electron: path.join(here, 'electronShim.ts')
  }
})

console.log('sidecar bundled -> dist/sidecar.cjs')
