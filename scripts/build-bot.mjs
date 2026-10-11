// Bundles the Discord bot (src/bot/index.ts) into out/bot/index.js, separately from
// electron-vite's own build (which only handles src/main/preload/renderer). It's built with
// esbuild rather than folded into electron-vite's Rollup-based main build because discord.js
// has internal circular requires (Base <-> Channel <-> GuildChannel <-> util) that Rollup's
// commonjs plugin reorders into a broken init sequence ("Class extends value undefined") -
// esbuild preserves real `require()` semantics and doesn't hit this. Spawned as its own OS
// process by src/main/lib/discordBot.ts via ELECTRON_RUN_AS_NODE, not imported into index.ts,
// so a crash in the bot's ~3000 lines of Discord-API logic can never take the Manager's own
// server-management process down with it (see README for the fault-isolation reasoning).
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [path.join(root, 'src/bot/index.ts')],
  outfile: path.join(root, 'out/bot/index.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Mirrors tsconfig.node.json's "@shared/*" path alias - esbuild doesn't read tsconfig
  // path mappings on its own, unlike tsc/vite.
  alias: { '@shared': path.join(root, 'shared') },
  // discord.js's gateway layer (@discordjs/ws) dynamically requires these three as optional
  // native-addon speedups (zlib/websocket frame validation) wrapped in its own try/catch -
  // never actually installed here (no native build toolchain needed for this bot), so they
  // must stay real runtime requires instead of something esbuild tries to resolve and bundle.
  external: ['zlib-sync', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info'
})
