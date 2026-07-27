import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Dependencies bundled directly into out/main/index.js instead of left as runtime
// `require()`s. They're all pure JS (no native addons), and electron-builder's
// production-dependency copying step was found to mis-place some of their nested
// transitive deps (e.g. archiver's own zip-stream -> archiver-utils chain) when packaging
// for Windows, causing "Cannot find module 'archiver-utils'" at runtime. Bundling removes
// the runtime dependency on node_modules being copied correctly for these packages.
const bundledMainDeps = [
  'archiver',
  'adm-zip',
  'ini',
  'node-cron',
  'pidusage',
  'rcon-client',
  'electron-store'
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledMainDeps })],
    resolve: {
      alias: {
        '@shared': resolve('shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
