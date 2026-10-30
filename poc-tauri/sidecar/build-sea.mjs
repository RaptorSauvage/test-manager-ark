// Builds dist/sidecar-bin: a standalone executable containing the Node runtime + the bundled
// sidecar, via Node's SEA (Single Executable Applications) feature. Run build.mjs first - this
// reads dist/sidecar.cjs, it doesn't produce it.
//
// Steps are the ones Node's own SEA docs describe, scripted instead of typed by hand each time:
// 1. node --experimental-sea-config writes a V8 code-cache blob from dist/sidecar.cjs
// 2. copy the current `node` binary
// 3. postject injects the blob into that copy under the NODE_SEA_BLOB section/sentinel
//
// Platform notes (only tested on Linux so far - see README.md):
// - Linux: works as-is, binary runs standalone with no `node` on PATH.
// - macOS: needs extra codesigning steps (`--macho-segment-name NODE_SEA` + re-signing) that
//   this script does not attempt.
// - Windows: should work (Node's docs describe it), not yet tried for real from this sandbox.
//
// Also copies the result into src-tauri/binaries/sidecar-bin-<target-triple>, the exact name
// and location Tauri's `bundle.externalBin` (see tauri.conf.json) requires to treat it as a
// real sidecar resource instead of a path main.rs has to know about by convention.
import { execFileSync } from 'node:child_process'
import { copyFileSync, chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const nodeBin = process.execPath
const outBin = path.join(here, 'dist', 'sidecar-bin')

const rustcHost = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  .split('\n')
  .find((line) => line.startsWith('host:'))
  ?.split(':')[1]
  ?.trim()
if (!rustcHost) throw new Error("could not determine the Rust target triple from `rustc -vV`'s `host:` line")

execFileSync(process.execPath, ['--experimental-sea-config', path.join(here, 'sea-config.json')], {
  cwd: here,
  stdio: 'inherit'
})

copyFileSync(nodeBin, outBin)
chmodSync(outBin, 0o755)

execFileSync(
  'npx',
  [
    '-y',
    'postject@latest',
    outBin,
    'NODE_SEA_BLOB',
    path.join(here, 'dist', 'sea-prep.blob'),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
  ],
  { cwd: here, stdio: 'inherit' }
)

const binariesDir = path.join(here, '..', 'src-tauri', 'binaries')
const windows = rustcHost.includes('windows')
const externalBinPath = path.join(binariesDir, `sidecar-bin-${rustcHost}${windows ? '.exe' : ''}`)
mkdirSync(binariesDir, { recursive: true })
copyFileSync(outBin, externalBinPath)
chmodSync(externalBinPath, 0o755)

console.log(`sidecar SEA binary -> ${outBin}`)
console.log(`                  -> ${externalBinPath} (Tauri externalBin)`)
