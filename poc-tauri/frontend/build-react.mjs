// Bundles each real-page entry file (manager-log-entry.tsx, profile-management-entry.tsx - each
// mounting a REAL, unmodified src/renderer/src/pages/*.tsx component) into its own .js, served
// by Tauri alongside index.html (frontendDist is a whole directory, not a single file, so this
// just adds more pages). Proves real renderer components, not just the business logic
// underneath them, can run against this architecture - see "A real React page" in README.md.
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')

const pages = ['manager-log', 'profile-management', 'player-roster', 'player-whitelist']

for (const page of pages) {
  await build({
    entryPoints: [path.join(here, `${page}-entry.tsx`)],
    outfile: path.join(here, `${page}.js`),
    bundle: true,
    format: 'esm',
    target: 'es2020',
    jsx: 'automatic',
    // Mirrors tsconfig.web.json's "@shared/*" path alias - esbuild doesn't read tsconfig path
    // mappings on its own (same finding as sidecar/build.mjs's own comment on this).
    alias: { '@shared': path.join(root, 'shared') },
    logLevel: 'info'
  })
  console.log(`React page bundled -> ${page}.js`)
}
