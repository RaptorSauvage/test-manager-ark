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
  alias: {
    electron: path.join(here, 'electronShim.ts')
  }
})

console.log('sidecar bundled -> dist/sidecar.cjs')
