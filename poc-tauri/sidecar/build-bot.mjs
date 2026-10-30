// Bundles the REAL, unmodified Discord bot (src/bot/index.ts) into sidecar/bot/index.js -
// the exact path lib/discordBot.ts's own botScriptPath() expects relative to wherever it's
// running from (path.join(__dirname, '..', 'bot', 'index.js')), so that real, unmodified file
// finds it without needing to know it's running inside this PoC at all. Mirrors the real repo's
// scripts/build-bot.mjs config exactly (same esbuild options, same external native-addon list)
// rather than inventing a second copy that could drift from it - see that file for why each
// option is there (discord.js's circular requires needing esbuild over Rollup, the three
// optional native speedups that must stay real runtime requires).
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

await build({
  entryPoints: [path.join(root, 'src/bot/index.ts')],
  outfile: path.join(here, 'bot', 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  alias: { '@shared': path.join(root, 'shared') },
  external: ['zlib-sync', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info'
})

console.log('bot bundled -> sidecar/bot/index.js')
