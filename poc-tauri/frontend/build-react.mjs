// Bundles manager-log-entry.tsx - which mounts the REAL, unmodified
// src/renderer/src/pages/ManagerLogView.tsx - into manager-log.js, served by Tauri alongside
// index.html (frontendDist is a whole directory, not a single file, so this just adds a second
// page). Proves a real renderer component, not just the business logic underneath it, can run
// against this architecture - see "A real React page" in README.md.
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')

await build({
  entryPoints: [path.join(here, 'manager-log-entry.tsx')],
  outfile: path.join(here, 'manager-log.js'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  // Mirrors tsconfig.web.json's "@shared/*" path alias - esbuild doesn't read tsconfig path
  // mappings on its own (same finding as sidecar/build.mjs's own comment on this).
  alias: { '@shared': path.join(root, 'shared') },
  logLevel: 'info'
})

console.log('React page bundled -> manager-log.js')
