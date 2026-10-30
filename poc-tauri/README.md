# Tauri shell PoC

Answers one question before committing to a real Electron → Tauri migration: can a Rust shell
spawn and talk to a persistent Node sidecar running the **existing, unmodified** application
logic, and get a real result back into a Tauri webview through an ordinary `invoke()` call?

This is scoped to exactly that round trip, now covering the actual headline case as well as the
supporting ones: a plain read (`profiles.list`), a write with parameters (`profiles.save`), two
independent push sources proving the mechanism generalizes (`profiles-changed` wrapping
`store.ts`'s own `profileEvents`, `manager-log-entry` wrapping `lib/managerLog.ts`'s own
`managerLogEvents`) - and now the real per-server **live console feed** itself
(`console.backlog`/`console.watch`, via `serverProcess.ts`'s real `watchLogFile` and
`lib/logEvents.ts`'s real `parseLogChunkWithDate`, both unmodified), which is what all of the
above was standing in for. All of that is Rust calling the sidecar; `folders_open_profiles`
proves the **other direction** too - the sidecar calling back into Rust for a real native action
(`lib/systemFolders.ts`'s real `openProfilesFolder()`, via Electron's `shell.openPath`) and
getting a real result back, over the same stdio pipe - see "The reverse direction" below.
`bot_start`/`bot_stop`/`bot_status` go beyond the main-process logic entirely: the real,
unmodified Discord bot subsystem (`lib/discordBot.ts` + `src/bot/`), which turned out to need no
porting work at all - and surfaced a genuinely significant SEA-packaging limitation along the
way, see "The Discord bot subsystem" below. `dashboard_start`/`dashboard_stop`/
`dashboard_status` prove the third and last subsystem from the original size estimate - the web
dashboard (`lib/webDashboard.ts`) - confirmed with a real HTTP client against the real embedded
dashboard page and the real `/api/servers` endpoint, see "The web dashboard subsystem" below.
Everything above is business logic; `manager-log.html` answers a different question - does the
real **UI** run against this architecture - by mounting the real, unmodified
`src/renderer/src/pages/ManagerLogView.tsx` against a `window.api` shim backed by Tauri instead
of Electron's `contextBridge`, see "A real React page" below. Window chrome, the menu bar, the
tray, the rest of the real renderer (`App.tsx`, routing, ~30 other pages), and the other ~34 IPC
modules in `src/main/ipc/` are still deliberately out of scope.

## What's here

- `src-tauri/` - a minimal Tauri 2 app, using `tauri-plugin-shell`'s real sidecar mechanism (not
  a hand-rolled `std::process::Command`) to spawn the sidecar on startup - see "Sidecar
  packaging" below. `src/main.rs` keeps a background async task reading the sidecar's stdout
  that routes each line either to the pending `call()` it answers (has an `"id"`), a
  `"shell-request"` (the sidecar calling back into Rust - see "The reverse direction" below), or
  out to the webview as an ordinary Tauri event (any other `"event"`), and exposes twenty-one
  Tauri commands: `profiles_list`, `profiles_save` (takes a profile object), `profiles_copy`/
  `profiles_move` (take `profileId`/`destInstallDir`/`newName` - see "A second real page" below),
  `log_record` (takes a message string), `manager_log_get_all` (see "A real React page" below),
  `server_start`/`server_stop`/`server_status` (take a `profileId`, `server_stop` also an
  optional `graceMs`) and `server_install_test_executable` (test-only - see "The actual headline
  case" below), `console_backlog`/`console_watch` (both take an `installDir`),
  `console_append_test_line` (test-only - see below), `folders_open_profiles`,
  `bot_start`/`bot_stop`/`bot_status` (see "The Discord bot subsystem" below),
  `dashboard_start`/`dashboard_stop`/`dashboard_status` (see "The web dashboard subsystem"
  below), and `dialog_select_directory` - the first command with no sidecar involvement at all,
  calling `tauri-plugin-dialog` straight from Rust (see "A second real page" below).
- `sidecar/sidecar.ts` - a newline-delimited-JSON RPC server over stdin/stdout. Imports
  `listProfiles`/`saveProfile`/`profileEvents` from **the real, untouched `src/main/store.ts`**,
  `logManagerEvent`/`managerLogEvents` from **the real, untouched
  `src/main/lib/managerLog.ts`**, `watchLogFile`/`getLogFilePath`/`startServer`/`stopServer`/
  `getStatus`/`serverEvents`/`getExecutablePath` (from **`src/main/lib/serverProcess.ts`**, 980
  lines - see "The actual headline case" below) plus `readLogBacklog`/`parseLogChunkWithDate`/
  `createLogEventCaches` (from **`src/main/lib/logEvents.ts`**), `openProfilesFolder` (from
  **`src/main/lib/systemFolders.ts`**), `copyProfile`/`moveProfile` (from
  **`src/main/lib/profileCopyMove.ts`**, see "A second real page" below),
  `startDiscordBot`/`stopDiscordBot`/
  `getDiscordBotStatus` (from **`src/main/lib/discordBot.ts`**, see "The Discord bot subsystem"
  below), and `applyWebDashboardSettings`/`stopWebDashboard`/`getWebDashboardStatus` (from
  **`src/main/lib/webDashboard.ts`**, 8200+ lines, see "The web dashboard subsystem" below) -
  none of it stubs or rewrites; every emitter is wired
  straight to a push-event line (`profiles-changed`, `manager-log-entry`, `console-line`,
  `server-status`), so
  every real write's/parsed log line's/status change's side effect reaches the webview the same way it would via
  Electron's `webContents.send`. `sidecar/electronShim.ts` stands in for the Electron APIs that
  import chain actually calls directly (`app.getPath`, a minimal `ipcMain` stub `electron-store`
  itself needs, and `shell.openPath` - see "Findings" below and "The reverse direction" below) -
  see "electron-store's own fallback" below for a wrinkle this found and a real crash it caused
  once genuinely installed. `sidecar/rpcToRust.ts` holds the small bit of plumbing
  `shell.openPath` needs to call back into Rust over the same stdio pipe (see "The reverse
  direction"). `sidecar/build.mjs` bundles it all with esbuild, aliasing `electron` → the shim
  and pointing esbuild at the project's own `tsconfig.node.json` (see "Findings" below for why),
  into a single dependency-free `dist/sidecar.cjs`. `sidecar/sea-config.json` +
  `sidecar/build-sea.mjs` turn that bundle into `dist/sidecar-bin` - a standalone executable
  with Node itself embedded, via Node's own SEA (Single Executable Applications) feature - so
  `main.rs` can spawn it directly with no `node` on the target machine at all (see "Sidecar
  packaging" below). `sidecar/build-bot.mjs` separately bundles the real, unmodified
  `src/bot/index.ts` (mirroring the real repo's own `scripts/build-bot.mjs`) into
  `sidecar/bot/index.js`, the exact relative path `lib/discordBot.ts`'s own `botScriptPath()`
  expects; `sidecar/build-bot-sea.mjs` packages that into its own separate SEA binary,
  `sidecar/bot/bot-bin` - see "The Discord bot subsystem" below for why. The web dashboard
  needed no separate build step at all - `webDashboard.ts` is just
  another file `sidecar/build.mjs`'s existing esbuild bundle already pulls in.
- `frontend/index.html` - a bare page (not the real React UI): calls `invoke('profiles_list')`
  on load; buttons call `invoke('profiles_save', { profile })`, `invoke('log_record', {
  message })`, `invoke('console_watch', { installDir })`, `invoke('console_append_test_line',
  { installDir, message })`, `invoke('server_install_test_executable')`/`invoke('server_start')`/
  `invoke('server_stop')`/`invoke('server_status')` (see "The actual headline case" below),
  `invoke('folders_open_profiles')`, `invoke('bot_start')`/
  `invoke('bot_stop')`/`invoke('bot_status')`, and `invoke('dashboard_start')`/
  `invoke('dashboard_stop')`/`invoke('dashboard_status')`; `listen('profiles-changed',
  ...)`/`listen('manager-log-entry', ...)`/`listen('console-line', ...)`/`listen('server-status',
  ...)` handlers update their
  own section the moment each push event arrives - independent of any button, proving the
  live-update path for all four. `frontend/manager-log.html` +
  `frontend/manager-log-entry.tsx` are different: not hand-written for this PoC at all, beyond a
  tiny `window.api` shim - they mount the real, unmodified
  `src/renderer/src/pages/ManagerLogView.tsx` - see "A real React page" below.
  `frontend/profile-management.html` + `frontend/profile-management-entry.tsx` do the same for
  the real, unmodified `src/renderer/src/pages/ProfileManagementView.tsx` - see "A second real
  page" below. `frontend/build-react.mjs` bundles both entries with esbuild (JSX support, the
  same `@shared/*` alias handling as the other build scripts).

## Running it

```sh
node sidecar/build-bot.mjs      # bundles sidecar/bot/index.js (needed before the first bot_start call)
node sidecar/build-bot-sea.mjs  # optional: packages that as sidecar/bot/bot-bin (fixes SEA + fork(), see below)
node sidecar/build.mjs          # bundles sidecar/dist/sidecar.cjs
node sidecar/build-sea.mjs      # builds dist/sidecar-bin AND copies it into src-tauri/binaries/
node frontend/build-react.mjs   # bundles manager-log.js (needed before opening manager-log.html)
cd src-tauri && cargo build     # or: cargo tauri dev, if the Tauri CLI is installed
./target/debug/tauri_poc_shell
```

`build-bot-sea.mjs` is optional - skip it and `bot_start` falls back to `discordBot.ts`'s normal
`fork()` behavior, which leaks a duplicate idle sidecar process instead of running the bot (see
"The Discord bot subsystem"); run it, and `main.rs` picks up `sidecar/bot/bot-bin` automatically
if it exists at build time, no extra flag needed.

`build-sea.mjs` is **not optional** before the first `cargo build`: `tauri.conf.json` declares
`bundle.externalBin: ["binaries/sidecar-bin"]`, and Tauri's own build script checks that
`src-tauri/binaries/sidecar-bin-<target-triple>` exists *at `cargo build` time*, not just at
runtime - `cargo build` fails outright (`resource path ... doesn't exist`) if that file is
missing, before any of this PoC's own code even runs. Re-run `build-sea.mjs` whenever
`sidecar.ts` changes; `cargo build` doesn't need to re-run unless `main.rs`/`Cargo.toml`
changed too, since Tauri just copies whatever's already in `binaries/`.

Set `SIDECAR_PATH` to a `node <path>`-style path (pointing at `dist/sidecar.cjs`) to skip all
of that and run the sidecar straight through a locally-installed `node` during iteration - no
`cargo build` needed at all when only `sidecar.ts` changes, and no `binaries/` setup required
first. `main.rs` reads this env var at startup, not compile time, and spawns it through the
plugin's generic `command()` API instead of `sidecar()` when it's set (see "Sidecar packaging").

Linux build needs `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `libsoup-3.0-dev`,
`libjavascriptcoregtk-4.1-dev`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, and
the usual `build-essential`. Windows needs Rust (via rustup), the "Desktop development with
C++" workload from the Visual Studio Build Tools (the MSVC linker - plain VS Code is not
enough, confirmed by actually hitting `error: linker 'link.exe' not found` without it), and
WebView2 (present by default on Windows 10 21H2+/11).

`icons/icon.ico` has to exist alongside `icons/icon.png` - found by actually building on
Windows, where `tauri-build` needs it (by that exact conventional path) to generate the
`.exe`'s Windows Resource file; the Linux build never asked for it because WebKitGTK has no
equivalent step. Regenerated here with `convert icon.png -define
icon:auto-resize=256,128,64,48,32,16 icon.ico` (ImageMagick).

To build and install a real package instead of just running the dev binary (`cargo install
tauri-cli --version "^2.0.0"` once, then):

```sh
cd src-tauri && cargo tauri build --bundles deb   # needs build-sea.mjs run first, same as above
sudo dpkg -i target/release/bundle/deb/tauri-poc-shell_0.1.0_amd64.deb
```

See "Actually bundled and installed with `cargo tauri build`" below before trusting a `cargo
build` dev run alone - it hid a real crash-on-install bug that only the actual bundle surfaced.

## Result

**Confirmed on real Windows (WebView2), not just this Linux sandbox:** the window opens clean
(dark background, correct icon, no white flash), the read path shows "Got 0 profile(s)..." on
load, and clicking "Save a test profile" **visually** updates the push-status line to the live
'profiles-changed' confirmation with the new entry in the list - the one thing the Linux/Xvfb
run below couldn't show directly. That closes the last open question from this PoC: the full
read + write + push round trip works end to end, through a real OS-provided webview, not just
through on-disk evidence.

**The read path** (`profiles_list`) is confirmed both by screenshot and by watching it run: the
webview calls `invoke('profiles_list')` → Rust writes a JSON-RPC request to the sidecar's stdin
→ the sidecar runs the real `listProfiles()` (full `electron-store` load, migrations,
everything `store.ts` normally does) → the response comes back over stdout → Rust resolves the
pending call → the webview renders it.

**The write + push path** (`profiles_save` → real `saveProfile()` → real `profileEvents`
→ `profiles-changed` event → the webview's `listen()` handler) was first confirmed on this
Linux sandbox by the resulting on-disk state rather than a screenshot (see "A rendering dead
end" below for why), then confirmed visually for real on Windows/WebView2 as noted above.
Triggering the button's handler on a timer and checking `~/.config/ark-server-manager-
nodejs/config.json` afterward showed the new profile, written with a timestamp matching that
exact run, through `saveProfile`'s *full* migration/defaulting pipeline (`queryPort`,
`maxPlayers`, every other field `migrateProfile` normally fills in) - not a partial or
stubbed write.

No code in `src/main/store.ts` was changed for any of this - only `app.getPath('documents')`
needed a stand-in to run outside Electron (see `electronShim.ts`).

**The live console feed** - the actual headline case, not a stand-in for it - is confirmed the
same way: a synthetic ShooterGame.log-shaped file (no real ARK server in this sandbox) run
through the real `readLogBacklog` for the backlog, then the real `watchLogFile` polling + real
`parseLogChunkWithDate` parsing for the live feed. A scripted standalone test (spawn the
sidecar, send `console.watch`, wait past one real poll tick, send
`console.appendTestLine`, wait past the next tick) produced exactly one `console-line` push
event, correctly parsed as a `CHAT` entry with the right player name and timestamp - the real
regex-based parser (the same one the desktop Console tab and Web Dashboard both already use),
not a simplified one written for this PoC. The Tauri command wiring (`console_backlog`/
`console_watch`/`console_append_test_line`) compiles and the app starts cleanly with it, but -
unlike `profiles_save` - wasn't separately re-verified through a live button click on Windows,
since it's structurally identical to that already-Windows-confirmed command (same `call()`
path, same param-passing shape); the sidecar-level logic underneath it is what's actually new,
and that's what got the scripted test.

Screenshot of the read path (Linux, WebKitGTK, via Xvfb - `Got 0 profile(s)` because this
sandbox has no real profiles.json, not because anything failed):

`Tauri shell PoC - real store.ts through a Node sidecar` / `Got 0 profile(s) from the real
store.ts, via the Rust shell -> Node sidecar round trip.`

### The reverse direction (sidecar calling Rust)

Everything above is one direction: Rust calls the sidecar, the sidecar answers or pushes
events. Real lib files that call Electron's `shell.*` (`systemFolders.ts`, `backup.ts`,
`mapManagement.ts`, ...) need the opposite direction too - `shell.openPath` is a native "open
this in the system file manager" call only the Rust shell can actually make, so the sidecar has
to ask Rust to do it and wait for a real answer, not fire-and-forget. Grepping every real call
site (`grep -rn "shell\.\(openPath\|showItemInFolder\)" src/main/lib/`) turned up only
`shell.openPath`, always in the same `await`-and-check-the-error-string shape, across 7 call
sites in 6 files - `showItemInFolder` isn't used anywhere, so that's the one method this needed
to prove.

**Architecture**: reuses the exact same bidirectional stdio pipe instead of opening a second
channel. `electronShim.ts`'s `shell.openPath(path)` calls `rpcToRust.ts`'s `callRust()`, which
sends a push-event-shaped line out on stdout (`{event: "shell-request", data: {id, method,
params}}` - using the event-name slot, not the RPC-method slot, since the sidecar is the one
initiating this time) and returns a `Promise` that resolves when a matching response arrives
back on stdin. `main.rs`'s reader task now recognizes `event === "shell-request"` specially:
instead of forwarding it to the webview like any other push event, it calls the real
`tauri-plugin-opener` crate (`app_handle.opener().open_path(path, None)`) and writes a plain
`{id, result}`/`{id, error}` line back onto the sidecar's own stdin - indistinguishable on the
wire from a response to an RPC call *Rust* itself made, except it's a separate id
counter/pending map going the other way, and `sidecar.ts`'s own line handler tells the two
apart by one rule: a line with a `"method"` field is a command from Rust, a line without one is
a response to one of the sidecar's own outgoing requests.

This needed `SidecarHandle.child` to become an `Arc<Mutex<CommandChild>>` shared between the
code that writes outgoing RPC requests and the reader task that now also writes shell-request
responses, both onto the same stdin.

**Proven real, not a mocked test, by porting an actual real file**: `folders_open_profiles`
calls `sidecar.ts`'s `folders.openProfiles` RPC method, which calls the real, unmodified
`openProfilesFolder()` from `lib/systemFolders.ts` - not a synthetic test method standing in
for the mechanism. That function itself calls `shell.openPath` internally; this PoC's code
never calls `shell.openPath` directly.

**Confirmed three ways**, each isolating a different layer:
1. A standalone Node script spawning `dist/sidecar.cjs` directly and acting as a fake Rust
   peer (reading the outgoing `shell-request` line, writing back a synthetic `{id, result:
   true}` response) confirmed the TypeScript side's id-correlation and promise resolution, for
   both the success and error-propagation paths, with no Rust involved at all.
2. Running the actual compiled Tauri app under Xvfb and clicking (via a temporary `setTimeout`
   trigger, reverted before committing) confirmed the real round trip end to end: Rust's stderr
   logged `sidecar shell-request 'openPath' -> Err("Launcher \"gio\" \"open\"
   \"/root/.tauri-poc-bober-manager\" failed with ExitStatus(unix_wait_status(512))")` - a real
   attempt by the real `tauri-plugin-opener` crate to run `gio open` against the real path
   `electronShim.ts`'s `app.getPath('userData')` resolves to, failing only because this headless
   sandbox has no GUI session/file manager registered to handle it (the same category of
   sandbox-specific gap as the WebKitGTK rendering limitation below, not an architecture bug).
3. The error correctly reached all the way back down through `write_line` → the sidecar's
   stdin → `resolveRustResponse` → the rejected `callRust()` promise → `shell.openPath`
   returning that message as a string (matching real Electron's own `shell.openPath` contract)
   → `openProfilesFolder()` throwing it → the RPC response's `error` field → the webview's
   `.catch()` handler, which is the complete real error-propagation path a real migration needs,
   not just the happy path.

This Rust-side `eprintln!` logging of every shell-request's outcome was kept in `main.rs`
(not reverted) - genuinely useful visibility into a native call that has no other feedback
path from inside this architecture.

### The Discord bot subsystem (a real packaging bug, found and fixed)

Everything above is the "main process logic" sidecar. The original size/migration estimate also
counted two more real subsystems - the Discord bot and the web dashboard - as separate sidecars,
listed in "What this doesn't prove yet" as completely untouched. This proves the bot one, and
the result was better *and* worse than expected: better, because it needed **zero porting work**
at all; worse, because it surfaced a real, consequential bug in this PoC's own SEA packaging
that the main-process sidecar's own tests never would have caught.

**Better than expected - already decoupled.** `grep -rl "from 'electron'" src/bot/` returns
nothing: the bot (`src/bot/`, ~3000 lines, `discord.js`) has zero Electron imports. It already
runs as its own OS process today, `fork()`ed by `lib/discordBot.ts` with `ELECTRON_RUN_AS_NODE=1`
specifically so it can't take the Manager down if it crashes, talking to the Manager purely over
the existing Web Dashboard HTTP API - not Electron IPC at all. `sidecar/build-bot.mjs` bundles
`src/bot/index.ts` completely unmodified (same esbuild config as the real repo's own
`scripts/build-bot.mjs`) into `sidecar/bot/index.js`, and `sidecar.ts`'s `bot.start`/`bot.stop`/
`bot.status` RPC methods call the real, unmodified `startDiscordBot()`/`stopDiscordBot()`/
`getDiscordBotStatus()` from `lib/discordBot.ts` directly - no shim, no stub, no new glue beyond
the three one-line RPC methods themselves. `startDiscordBot()` round-trips through the real
`saveSettings()`/`getSettings()` (flipping `discordBotEnabled`/`discordBotToken` on, the same
shape the real Settings UI would send) and reuses the exact same `manager-log-entry` push event
already proven for `log.record` - `discordBot.ts`'s own `logManagerEvent` calls on start/exit
reached the webview with no new wiring at all.

**Confirmed under `SIDECAR_PATH` dev mode** (plain `node`, not the SEA binary): a standalone
script acting as a fake Rust peer showed the complete real lifecycle - `bot.start` → real
`fork()` → the real bundled bot process actually starts, reads its config, attempts
`client.login()` against Discord's real gateway, and (no outbound DNS to discord.com in this
sandbox) fails with `getaddrinfo ENOTFOUND discord.com`, exiting cleanly with code 1. That
exit is caught by `discordBot.ts`'s own real `proc.on('exit', ...)` handler, which pushes a
second real `manager-log-entry` event and updates `lastError` - all unmodified code, reproduced
through the real compiled Tauri app running under Xvfb (checked via the real
`~/Documents/.../logs/manager.jsonl` file, not a screenshot, for the same reason as "A rendering
dead end" below): `"Démarrage du bot Discord..."` then `"Le bot Discord s'est arrêté (code 1)."`,
exactly matching the standalone result.

**Worse than expected - a real bug, found by running the actually-installed thing, not the dev
build** (same lesson as "Actually bundled and installed with `cargo tauri build`" above, this
time without even needing `cargo tauri build` - the plain dev binary already showed it once
pointed at the default SEA sidecar instead of `SIDECAR_PATH`): calling `bot.start` against the
**default** sidecar (the compiled SEA binary, not `SIDECAR_PATH` dev mode) spawns a process that
prints `sidecar: ready` - the *main sidecar's own* startup banner, not anything from
`sidecar/bot/index.js` - and then just sits there, alive, doing nothing, forever. Confirmed with
a minimal, decisive test: running `./sidecar-bin /path/to/bot/index.js /path/to/config.json`
directly (extra positional args most Node programs would treat as `process.argv`) behaves
identically to running `./sidecar-bin` with no arguments at all. **Node's SEA packaging bakes in
one fixed entry point and ignores any script-path argument entirely** - there is no way to tell
a SEA binary "run this other file instead." `fork()`'s whole mechanism is built on the opposite
assumption (re-execute `process.execPath` with a *different* module path as the first argument),
so `lib/discordBot.ts`'s `fork(botScriptPath(), [configPath], ...)` - completely correct, and
exactly how every other Node program spawns a worker script - silently does the wrong thing the
moment `process.execPath` is a SEA binary instead of a real `node`: it leaks a second, idle copy
of the *main* sidecar process instead of running the bot, with no error anywhere (not even in
`discordBot.ts`'s own `proc.on('error', ...)` handler - `fork()` itself reports success, because
from the OS's perspective a process genuinely did start).

This is a materially different kind of finding than everything above: not a config quirk or
a sandbox limitation, but a real architectural incompatibility between two pieces of this PoC
that each work fine on their own - Node SEA packaging (proven solid for the main sidecar) and
`fork()`-based worker spawning (proven solid as *application code*, unmodified, under `node`).

**Fixed and validated, not just diagnosed** - this is the one place in the whole PoC where a
real `src/main/lib/` file needed an actual code change, not just a shim or new RPC glue, so it's
worth being explicit about exactly what changed and why. `lib/discordBot.ts`'s `fork()` call now
checks an optional `BOT_LAUNCH_COMMAND` environment variable first: unset (every normal build,
including every real Electron build - Electron's own executable is never a SEA binary), nothing
changes at all, same `fork(botScriptPath(), ...)` as before; set, it calls
`spawn(launchCommand, [configPath], { stdio: [..., 'ipc'], env: {...} })` instead - an explicit
path to spawn rather than an implicit re-exec of `process.execPath`, with the `'ipc'` stdio slot
so `child.send()`/the exit/stdout/stderr handling all keep working exactly as `fork()` already
provided them. Fifteen lines, reviewed against the existing test suite (`npx vitest run
tests/discordBot.test.ts`: 16/16 still pass) and `npx tsc --noEmit -p tsconfig.node.json` (clean)
before being trusted.

`sidecar/build-bot-sea.mjs` packages the bot (`sidecar/bot/index.js`) as its own separate SEA
binary (`sidecar/bot/bot-bin`), the same `--experimental-sea-config`/`postject` steps as
`build-sea.mjs` uses for the main sidecar, and copies it to
`src-tauri/binaries/bot-bin-<target-triple>`. `tauri.conf.json`'s `bundle.externalBin` now lists
`"binaries/bot-bin"` alongside `"binaries/sidecar-bin"` - the real mechanism this time, not the
dev-only `CARGO_MANIFEST_DIR` shortcut an earlier version of this fix used (which would have
resolved to a source-tree path that doesn't exist once genuinely installed, quietly leaving
`bot_start` broken again the moment anyone actually shipped a bundle). `main.rs`'s
`spawn_sidecar` now resolves `bot-bin`'s real location the same way `tauri-plugin-shell`'s own
(private) sidecar-path resolution does internally - `std::env::current_exe()?.parent()?.join(...)`
- replicated by hand since there's no public API to ask for a resolved path without spawning, and
confirmed by reading the plugin's own source rather than guessing. Only passed as
`BOT_LAUNCH_COMMAND` when that file actually exists, so a plain `cargo build` without ever
running `build-bot-sea.mjs` still works exactly as before (confirmed: removed `bot-bin`,
rebuilt, ran clean).

**Confirmed fixed through the real, compiled app, both in dev mode and as a genuinely installed
package - not just standalone.** Dev mode: `cargo build` copies `binaries/bot-bin-<triple>` to a
plain `bot-bin` right next to `target/debug/tauri_poc_shell`, confirmed on disk before even
running anything; then, with no manual env vars set, `bot_start` against the **default SEA
sidecar** showed the real bot's own distinctive log line (`"Connexion à Discord impossible :
getaddrinfo ENOTFOUND discord.com"`, timestamped, not `"sidecar: ready"`) in `manager.jsonl`,
followed by a clean exit and no leaked process - the same correct behavior `SIDECAR_PATH` dev
mode always had, now also working under the packaging mode that actually ships. Then
`cargo tauri build --bundles deb` (87 MiB now, two embedded Node runtimes): `dpkg --contents`
confirmed `usr/bin/bot-bin` genuinely inside the package next to `usr/bin/sidecar-bin`, and after
a real `dpkg -i` install, running `/usr/bin/bot-bin` directly (standalone, the exact binary the
installed app would resolve to) reproduced the identical real failure - the same evidence
`Command::env()` receives the right path either way, dev or installed, from the same
`current_exe()`-relative logic.

### The web dashboard subsystem

The third and last subsystem from the original size estimate. `lib/webDashboard.ts` is big
(8200+ lines) and pulls in a large slice of `src/main/lib/` transitively (`serverActions.ts`,
`backup.ts`, `rcon.ts`, `groupConsole.ts`, `statsHistory.ts`, `fileBrowser.ts`, ...) - it's the
real app's entire Web Dashboard HTTP API and embedded frontend in one file, not a small
single-purpose module like the others this PoC has ported so far.

**Architecturally different from the bot in one important way, confirmed by just reading it
rather than assuming**: unlike the bot, the web dashboard was never a separate OS process even
in the real app - `startWebDashboard()`/`stopWebDashboard()` just create a plain
`http.Server`/`https.Server` (Node's own built-in modules) **in the same process** as
everything else, listening on a port directly. There's no `fork()` anywhere in this file, so
none of "The Discord bot subsystem"'s SEA-packaging problem applies here at all - this is just
more functions this sidecar can call, the same shape as `systemFolders.ts`.

**Added to `sidecar.ts` and it bundled clean on the first try** - no missing-module errors, no
new Electron-shim gaps (the existing `app.getPath` coverage was already enough), despite the
large transitive import graph. `dashboard.start`/`dashboard.stop`/`dashboard.status` call the
real, unmodified `applyWebDashboardSettings()`/`stopWebDashboard()`/`getWebDashboardStatus()`
directly, through the same real `saveSettings()`/`getSettings()` round trip as every other real
subsystem this PoC touches.

**Confirmed the most thoroughly of anything in this PoC, because it's the one subsystem a real
HTTP client can check without any webview/Xvfb involvement at all.** Standalone (a fake-Rust-peer
script, same technique as "The reverse direction"): `dashboard.start` → a real `http.Server`
actually listening on `127.0.0.1:18090` → a real `GET /api/servers` returns `200` with a real
`[]` (correctly empty, no profiles exist) → a real `GET /` returns the real embedded dashboard
page (`<title>Bober Server Manager - Web Console</title>`, not a stand-in) → `dashboard.stop` →
a follow-up request gets a real `ECONNREFUSED`, proving the server genuinely stopped, not just
that the RPC call returned. Then reproduced through the **actual compiled Tauri app**, started
for real (`./target/debug/tauri_poc_shell`, default sidecar - the SEA binary, not
`SIDECAR_PATH`), triggered via `invoke('dashboard_start')`, and checked with a plain `curl` from
a completely separate terminal, entirely outside the app: `curl http://127.0.0.1:18090/`
returned the real dashboard HTML, `curl http://127.0.0.1:18090/api/servers` returned the real
`[]`. This sidesteps "A rendering dead end" below entirely - no screenshot, no on-disk-state
proxy, no WebKitGTK repaint question at all, just an ordinary HTTP response from a real server
running inside the real app.

Unlike the Discord bot, **nothing broke here** - worth stating plainly rather than only ever
reporting bugs: a 8200-line file with a large transitive dependency graph, including several
subsystems this PoC hasn't touched directly yet (`serverActions.ts`, `backup.ts`, `rcon.ts`, the
group console, stats history, the file browser), bundled and ran correctly the first time it was
tried, serving real HTTP responses through every layer of this PoC's architecture (Rust shell →
sidecar → real app code → real HTTP server → real HTTP client) with zero new workarounds needed.

### A real React page

Every proof above is about the application logic underneath the UI - `frontend/index.html` has
always been a bare, hand-written page, not the real renderer, standing in for the question "does
the architecture carry a real call correctly," not "does the real UI work against it." This is
the first time that second question gets a real answer: can an actual, unmodified page from
`src/renderer/src/` run against a Tauri `window.api` shim instead of Electron's
`contextBridge`-exposed one?

**Picked `ManagerLogView.tsx`** (`src/renderer/src/pages/`, 146 lines) deliberately: it's small
and self-contained (no imports beyond React and a shared type), and it corresponds exactly to a
subsystem this PoC had already proven at the RPC layer (`log.record`/`manager-log-entry`), so
porting it tests the UI layer specifically, not a new backend capability bundled in with it. It
calls exactly two methods - `window.api.managerLog.getLog()` and
`window.api.managerLog.onLogChanged(callback)` - everything else in the file (its own grouping
logic, its own date/time formatting, its own JSX, its own CSS class names) is real, unmodified
production code.

**The port is almost entirely on the Rust/sidecar side, not the component.** `sidecar.ts` gained
one line (`'log.getAll': () => readManagerLog()`, the real, already-imported-from-the-same-file
function backing the real preload's `managerLogGet` IPC handler) and `main.rs` one matching
`manager_log_get_all` command. `poc-tauri/frontend/manager-log-entry.tsx` (new) defines a
`window.api` object with exactly the two methods `ManagerLogView.tsx` calls - `getLog` forwards
to `invoke('manager_log_get_all')`, `onLogChanged` forwards to
`listen('manager-log-entry', ...)` - then imports the real component unmodified and mounts it
with `createRoot`. `poc-tauri/frontend/build-react.mjs` bundles that entry with esbuild
(`jsx: 'automatic'`, the same `@shared/*` alias handling as the other build scripts) into
`manager-log.js`, served by Tauri as a second page (`manager-log.html`) alongside `index.html` -
`frontendDist` is a whole directory, so this needed no `tauri.conf.json` changes at all.

**Confirmed with real data, not an empty state.** Seeded a real entry into the real
`manager.jsonl` first (piping a `log.record` call directly into the SEA sidecar binary,
standalone), then pointed the app's main window at `manager-log.html` directly (a temporary
`tauri.conf.json` window `url` override, reverted immediately after) and screenshotted the
result under Xvfb. The real component rendered the real seeded entry correctly - its own
"Manager Log" header, its own description paragraph, its own task-grouping with the real
`taskLabel` ("Tauri PoC") and the exact seeded message text - all through `getLog()`'s real
`invoke` → Rust → sidecar → `readManagerLog()` → the real JSONL file round trip. This is a
first-frame screenshot (see "A rendering dead end" below for why that's the reliable one in this
sandbox), so it directly confirms the read path; the live-push path (`onLogChanged`) wasn't
separately re-screenshotted, since it's structurally identical to the already-proven
`listen('manager-log-entry', ...)` call `index.html`'s own vanilla-JS listener already uses -
the new code here is purely the `window.api` wrapper around it, not the event delivery itself.

This doesn't generalize to "the whole real UI runs on Tauri" by itself - one small, read-heavy
page is not the real `App.tsx` with its routing, Context providers, and ~30 other pages each
touching a different slice of `window.api`. What it does show is the actual *shape* of that
port: no change to the real component, a `window.api` object built to the same surface the real
preload already defines, and the Rust/sidecar side doing the same kind of one-line RPC-method
addition this whole PoC has done repeatedly elsewhere - not a rewrite of the UI layer, just
another thin transport swap underneath it.

### A rendering dead end (and why it doesn't undercut the result above)

Confirming the write+push path visually turned into its own small investigation. In order:

1. `xdotool click` at the button's screen coordinates did nothing - no error, no state change at
   all, not even a focus ring.
2. Focusing the window first and clicking by window-relative coordinates got a focus ring to
   appear on the button, but still no click handler firing.
3. Switched to triggering the save on a `setTimeout` instead of a real click, to isolate "is
   input simulation the problem" from "does the write+push path work" - still nothing changed
   on screen after waiting well past the timer.
4. That ruled out input simulation specifically, which pointed at something more fundamental:
   edited `frontend/index.html` **without** rebuilding the Rust binary first, assuming
   `frontendDist` is read live from disk. It isn't - Tauri embeds it at `cargo build` time, so
   every edit needs a rebuild before it's visible, which this PoC's own first few check-ins
   quietly got right only by accident (the README already said `cargo build` in "Running it").
   After rebuilding, the on-disk write started happening on schedule (see above) - the
   architecture worked the whole time.
5. What still never changed was the **screen**. Checked the actual file on disk (not the
   screenshot) and found the write already there, timestamped to the right second. So the
   webview's JS executed, `invoke`/the event listener both did their job, and the DOM almost
   certainly updated - but WebKitGTK never repainted the X window to reflect it. Tried
   `LIBGL_ALWAYS_SOFTWARE=1` (cleared the DRI3/EGL warnings) and forcing a relayout via
   `xdotool windowsize` (a common repaint trigger) - neither changed the screenshot. The first
   frame painted correctly every time; nothing after that ever did.

Read together, this looks like a software-rendering compositing limit specific to WebKitGTK
under a bare Xvfb (no window manager, no real GPU) in this particular sandbox, not a problem
with the Tauri/sidecar architecture itself - the filesystem was a more reliable witness than a
screenshot here, and it said the write and the push event both landed. **Confirmed**: a real
Windows/WebView2 run showed the push-status line update live on screen after clicking the
button, exactly as expected - the gap this section describes was specific to this Linux
sandbox's rendering, not the architecture.

### A second real page: write paths and a native dialog

`ManagerLogView.tsx` above was deliberately the easy case: read-only, one subsystem already
proven at the RPC layer, no native OS interaction. `ProfileManagementView.tsx`
(`src/renderer/src/pages/`, 165 lines) was picked next specifically because it isn't that - it's
a write path (copy/move an entire server install) with a native folder-picker dialog in front of
it, which is architecturally new territory for this PoC in two ways at once.

**The write side is the same shape as everything else.** `window.api.profiles.copy`/`.move` call
the real, unmodified `copyProfile()`/`moveProfile()` from `lib/profileCopyMove.ts` - a file with
zero Electron coupling already (confirmed earlier by reading it in full) - through two new
sidecar RPC methods (`profiles.copy`/`profiles.move`) and two matching `main.rs` commands
(`profiles_copy`/`profiles_move`), exactly the same `invoke → Rust → sidecar → real function`
shape `profiles_list`/`profiles_save` already proved. One deliberate scoping cut: the real
`ipc/profiles.ts` handler also re-runs `applyBackupSchedule`/`syncPlayerBackupWatch`/
`applyScheduledRestart`/`applyScheduledDinoWipe`/`applyScheduledRconCommands`/
`applyScheduledMaintenance` on the result, re-arming file watchers and cron-like timers against
the profile's new path - left out here since there's no real server process or backup content in
this sandbox to observe it against, and it isn't what this increment tests. A real migration
still has to port that wiring; it's the same kind of real file-copy/move operation as any other,
not a new question about the architecture.

**Confirmed against real files, not a mocked response.** Standalone, piping JSON-RPC lines
directly into the SEA sidecar binary (same technique as seeding `manager.jsonl` earlier): seeded
a profile pointing at `/tmp/poc-profile-src` (two real files in it), called `profiles.copy` with
a new destination, and confirmed on disk - not just in the RPC response - that
`/tmp/poc-profile-dest-copy` now contains byte-identical copies of both files and the source is
untouched. Then called `profiles.move`: the destination got the files, `newName` was reflected in
the result, and critically `/tmp/poc-profile-src` **no longer exists** - `fs.promises.rename`'s
real behavior, not a copy pretending to be a move. `config.json` (the real electron-store-backed
file) gained the new/renamed profile entries both times, through the exact same `saveProfile()`
this PoC's very first round already proved.

**The native dialog is the actually new architectural shape.** Every prior proof in this PoC -
`profiles.*`, `log.*`, `console.*`, the bot, the web dashboard - is a sidecar RPC call with Rust
as a thin passthrough. `window.api.dialog.selectDirectory()` isn't: the real `dialog.ts`
(`src/main/ipc/dialog.ts`, read in full earlier) calls Electron's `dialog.showOpenDialog`
directly against a `BrowserWindow` handle - it's a main-process/window-level concern in the real
app too, with zero business-logic file in between. So `dialog_select_directory` in `main.rs` is
the first command in this PoC with **no sidecar involvement at all**: a plain `#[tauri::command]`
calling `tauri-plugin-dialog`'s `app_handle.dialog().file().blocking_pick_folder()` straight from
Rust - matching the real app's own architecture rather than inventing a sidecar round trip for
something that was never routed through one.

**Confirmed: real data renders through both commands together.** Pointed the main window at a
new `profile-management.html` (same temporary-`tauri.conf.json`-`url`, reverted-after technique
as `manager-log.html`) and screenshotted under Xvfb. First attempt showed the dropdown populated
with the real seeded profile name but nothing below it - traced to a wrapper-only bug (not in the
real component): the real `App.tsx` only ever mounts `ProfileManagementView` after its own
app-wide `profiles` state is already loaded, but this PoC's thin `ProfileManagementPage` wrapper
was mounting it immediately with an empty array and filling `profiles` in after
`invoke('profiles_list')` resolved - and `ProfileManagementView`'s own `selectedId` state is
seeded from `profiles[0]` only once, at mount, so it never picked up the real data once it
arrived. Fixed by gating the mount on the fetch resolving first (`profile-management-entry.tsx`),
matching the real app's own mount order instead of working around the component. After the fix,
the re-screenshot shows the complete real form: the real dropdown, "Current install folder:
/tmp/poc-profile-dest-move" (the exact path the standalone `profiles.move` test above produced),
the copy/move radio buttons, and the destination/name fields - the real, unmodified component
rendering real data through both the sidecar RPC path and (indirectly, via the same `profiles`
state) the architecture the native-dialog command will feed into.

**The native dialog itself does not complete in this sandbox - and fails differently than
`shell.openPath` did.** Called `dialog_select_directory` directly (a minimal temporary test page,
same `tauri.conf.json`-`url` technique, invoking it on load and recording the result in the
window title) and waited 10+ seconds: the window title never changed - no result, no error.
Screenshotting mid-wait showed the main window's content had gone blank white (not just
unrepainted, as in "A rendering dead end" above - genuinely blank), and `xdotool search` found
two new, unnamed X windows appear alongside the main one that weren't there before the call. Read
together, this looks like `blocking_pick_folder()` genuinely attempting to create a native dialog
surface - unlike `shell.openPath`'s `gio open`, which failed fast and cleanly with no GUI session
at all - and then blocking indefinitely waiting for a human click that can never come
unattended, rather than erroring out. This is a sandbox-only gap, not a sign the plugin is wired
wrong (the call compiles, the command registers, and something real happens on calling it,
which is more than "nothing happens"); it just means this one piece - unlike every other native
call this PoC has made - needs a real desktop session with a human at the keyboard to confirm the
happy path, something to flag honestly rather than paper over with a synthetic "it returned
`null`" result this sandbox didn't actually produce.

This round's overall shape: a write path through the sidecar ports exactly like a read path did,
with one real scoping cut (schedule re-arming) worth remembering for a real migration; a
main-process-only concern (the native dialog) ports as a main-process-only Rust command, not a
sidecar call, because that's what the real app's own architecture already says to do; and a
wrapper-only ordering bug was caught and fixed specifically *because* this PoC insists on
screenshotting real data through the real component, rather than trusting it compiles correctly.

### The actual headline case: starting and stopping a real server process

Every proof so far has been about *reading* or *writing data* - profiles, logs, console output,
even the bot and web dashboard subsystems are ultimately about moving information around. None of
it has touched the one thing a "server manager" actually exists to do: start and stop a real
server process. `lib/serverProcess.ts` (980 lines - PID tracking, RCON-confirmed graceful
shutdown with a force-kill fallback, a staggered spawn queue, crash/adoption handling) had been
completely untouched until this round.

**`startServer()`/`stopServer()`/`getStatus()` are real, unmodified, and need no Electron shim at
all.** `startServer()` does a plain `child_process.spawn(getExecutablePath(profile),
buildLaunchArgs(profile), { cwd, detached, stdio: 'ignore' })` - no `app.*`/`shell.*` coupling
anywhere in this path, confirmed by the fact that porting it needed zero additions to
`electronShim.ts`. `getExecutablePath` is already platform-aware
(`def.executableWin`/`def.executableLinux` per game, from `shared/games.ts`) - on this Linux
sandbox it resolves to each game's real `executableLinux` path (e.g.
`ShooterGame/Binaries/Linux/ArkAscendedServer` under the profile's `installDir`), so there was no
Windows-only code path to work around for this proof. Two new sidecar RPC methods
(`server.start`/`server.stop`, taking a `profileId` and resolving the real profile the same way
`profiles.copy`/`.move` already do) and three matching `main.rs` commands
(`server_start`/`server_stop`/`server_status`) are the entire port - same thin-wrapper shape as
every other subsystem in this PoC.

**No real ARK/Minecraft dedicated server binary exists in this sandbox, so standalone/compiled-app
testing needed a stand-in - the same role `console.appendTestLine` already played for log output,
now for the process side.** A test-only third RPC method, `server.installTestExecutable`, writes
a tiny long-running shell script to the real, unmodified `getExecutablePath(profile)`'s resolved
path (`#!/bin/sh` + a `sleep`-forever loop, exiting cleanly on SIGTERM like a real game server
does). Nothing about `startServer()`/`stopServer()` themselves is faked or stubbed - only the
"game server" they spawn is synthetic, exactly the same honesty boundary the console-feed proof
already drew.

**Confirmed standalone, piping JSON-RPC lines directly into the SEA sidecar binary (one
continuous session, start through stop):** `server.start` really spawns the fake script as a real
OS process - `ps` showed the exact real command line `buildLaunchArgs()` produced
(`TheIsland_WP?listen?Port=7777?RCONEnabled=True?RCONPort=27020 -server -log
-ServerPlatform=PC -WinLiveMaxPlayers=70`) running under a genuine new PID. Two `server-status`
push events arrived unprompted (`starting` with no pid, then `starting` with the real pid) -
`emitStatus()`'s own two-stage shape, reached through this sidecar exactly like
`profiles-changed`/`manager-log-entry` were. `server.stop` ran the real shutdown sequence:
`sendRconCommand(profile, 'SaveWorld')` failed immediately (no `ServerAdminPassword` on this fake
profile, so `rcon.ts` never even opens a socket) and was then correctly skipped to the
grace-period wait rather than treated as license to send `DoExit` - `waitForExitOrKill` waited out
the full `graceMs`, sent one SIGTERM, and `getStatus()` afterward (checked both via the push event
and a fresh `server.status` call) correctly reported `stopped`, confirmed independently against
the real OS process list (the pid was genuinely gone, not just marked gone in the store).

**A real bug this found in testing, not in the port:** the stand-in script's first version
ignored SIGTERM entirely (to deliberately exercise the force-kill path, or so the thinking went).
That made `stopServer()` take the full `graceMs` *plus* `FORCE_KILL_CONFIRM_MS` (10 seconds,
hardcoded in `serverProcess.ts`) to resolve - because `waitForExitOrKill`'s "force kill" is
actually just **one** `child.kill()` call (SIGTERM, Node's default signal) followed by a poll with
a 10-second give-up, not an escalation to SIGKILL. If a real game server process ever truly
ignored SIGTERM, `stopServer()` would still resolve as `stopped` after that 10-second give-up -
`finalizeStopped`/`running.delete` run unconditionally once `giveUp` fires - while the actual OS
process kept running, orphaned, outside the Manager's tracking. Real ARK/Minecraft dedicated
servers do exit on SIGTERM (this is airplane-visible AAA-game-server behavior, not something that
needs re-confirming here), so this almost certainly never happens in practice - but it's a real
property of the unmodified shutdown code, found by testing with a deliberately misbehaving
stand-in, not a flaw introduced by this port. Fixed the stand-in to exit on SIGTERM (what a real
server actually does) for the rest of this round's testing, once the finding was noted.

**Confirmed through the real compiled app, not just standalone.** Ran the actual
`tauri_poc_shell` binary under Xvfb with a temporary, immediately-reverted `setTimeout` chain in
`index.html` driving Save → Install fake executable → Start → (2s later) Stop - the same
"temporary trigger, verified on disk, reverted before commit" technique established in "A real
rendering dead end," here checking the real OS process list instead of the filesystem.
`ps aux | grep ArkAscendedServer` showed nothing at t=3s (before Start), the real spawned process
(exact real command line) at t=5s, and nothing again at t=11s (after Stop's grace period and
SIGTERM) - end to end through the real webview → `invoke()` → Rust → sidecar → `startServer()`/
`stopServer()` round trip, not just the standalone sidecar test above.

**What this doesn't prove yet, beyond "no real game server binary":** `adoptPersistedProcesses`
(reattaching to a still-alive pid from a previous session on startup - not wired into this PoC's
`main()` at all), the staggered spawn queue (`reserveSpawnSlot`, only exercised when multiple
servers start within the stagger window), `watchLogFileForMarker`'s "fully started" detection
(the fake script never writes a matching log line, so status never advances past `starting` to
`running` - a real finding, not a bug: without a real server actually logging its own startup,
there's no honest way to simulate that transition), the Windows-only `.bat`-launch path for ARK:
Survival Evolved (`launchViaBatch`, untested - this sandbox is Linux and the test profile used
`ark-ascended`, which never takes that branch), and no UI page calls any of this yet (`Dashboard.tsx`,
758 lines, is where the real Start/Stop/Restart buttons live - out of scope for this round, which
proved the RPC layer first, the same order bot/web-dashboard were proven in before any UI).

### Measured, on this Linux sandbox

- Release binary (`src-tauri/target/release/tauri_poc_shell`): **11 MB**, vs. `node_modules/electron`'s 266 MB.
- Sidecar bundle (`sidecar/dist/sidecar.cjs`, includes `electron-store` and its deps): **392 KB**.
- Idle RSS: shell **~145 MB**, Node sidecar **~48 MB** (~193 MB combined), measured via
  WebKitGTK with software rendering (no GPU passthrough in this sandbox - `libEGL warning: DRI3
  error`). **Do not take this as the Windows number** - WebView2 on Windows shares the
  system Edge/Chromium runtime already installed on the machine rather than embedding its own
  copy the way Electron does, and runs with real GPU acceleration on real hardware; both cut
  against this measurement in opposite, hard-to-predict ways. The disk-size comparison above is
  solid regardless of platform; the RAM comparison needs a real Windows run to mean anything.

### Sidecar packaging (Node SEA)

The dev setup above (`SIDECAR_PATH` pointing at `dist/sidecar.cjs`, run via `node`) was always
flagged in this README as "not how a shipped build would locate it" - this is that gap closed,
at least on Linux. Node's own SEA (Single Executable Applications) feature, stable since Node
20 and confirmed present here on Node 22.22.0, bundles the Node runtime itself plus
`dist/sidecar.cjs` into one standalone executable:

```sh
node --experimental-sea-config sea-config.json   # writes dist/sea-prep.blob
cp "$(command -v node)" dist/sidecar-bin
npx postject dist/sidecar-bin NODE_SEA_BLOB dist/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```
(scripted as `build-sea.mjs`, run after `build.mjs`).

**Confirmed working, not just built:** piping a raw JSON-RPC line into the resulting
`dist/sidecar-bin` directly (no `node` invocation) returned a correct `profiles.list` response.

**The honest tradeoff this surfaces:** `dist/sidecar-bin` is **~119 MB**, because it embeds a
full copy of the Node runtime (the `node` binary on this machine is ~123 MB; the SEA blob adds
~400 KB on top of that for the actual application code). That's not a packaging inefficiency to
fix later - it's the actual cost of "no `node` needed on the target machine," here or with any
other approach (a bundled portable Node runtime next to a plain `.cjs` would cost the same
~120 MB, just as two files instead of one). Combined with the 11 MB shell, that's **~130 MB**
total for this one sidecar - still well under Electron's 266 MB, but nowhere near the "11 MB
shell + 392 KB sidecar" numbers above might imply on their own if read without this section.
Two sidecars built this way (main process logic, bot - see "The Discord bot subsystem" below),
each embedding its own full Node copy, would start to erode the size advantage this whole
migration is supposed to deliver - worth weighing against a single shared sidecar process
serving both roles instead of one SEA binary per role. The web dashboard turned out not to add
a third: see "The web dashboard subsystem" below - it's an in-process `http.Server`, not a
separate process, so it rides along in the main sidecar's own SEA binary for free.

### Wired into Tauri's real `externalBin` mechanism, not just spawned by path

The SEA binary above was initially spawned with a hand-rolled `std::process::Command` pointed
at a source-tree path - functional, but explicitly flagged as not the real packaging mechanism.
That gap is now closed: `main.rs` spawns the sidecar through `tauri-plugin-shell`'s actual
sidecar API (`app.shell().sidecar("sidecar-bin")`, added as a dependency), and
`tauri.conf.json` declares `bundle.externalBin: ["binaries/sidecar-bin"]` - the real,
documented mechanism for shipping a non-Rust helper binary inside a Tauri app. `build-sea.mjs`
now also copies its output to `src-tauri/binaries/sidecar-bin-<target-triple>` (queried via
`rustc -vV`'s `host:` line), the exact filename convention Tauri's build script requires.

Rewriting the Rust side for this meant swapping the manual `Child`/`ChildStdin`/`BufReader`
plumbing for the plugin's own `Command`/`CommandChild`/`CommandEvent` types - a different API
shape (`CommandEvent::Stdout`/`Stderr`/`Error`/`Terminated` arrive over an async
`tauri::async_runtime::Receiver` instead of a blocking `BufReader::lines()` iterator on a
dedicated thread), but the same JSON-RPC protocol underneath, so `sidecar.ts` needed no changes
at all.

**Confirmed, not just compiled:** rebuilt and ran the app under Xvfb again with this change in
place. `pstree` showed the same result as before - `sidecar-bin` as a direct child of
`tauri_poc_shell`, no `node` anywhere - but this time resolved through the real `externalBin`
path instead of a hardcoded one. The read path was re-confirmed via the "Got 0 profile(s)..."
screenshot. The write + push path was re-confirmed the same way as the original write+push
verification: a temporary `setTimeout`-triggered save (reverted before committing, same
technique as the original "rendering dead end" investigation below), checked against the
on-disk store file - the full real `saveProfile()` migration/defaulting pipeline ran and wrote
correctly through this new transport, with no errors in the sidecar's inherited stderr.

**Still open:** `SIDECAR_PATH` dev iteration now goes through `app.shell().command("node")`
instead of a raw `Command::new("node")` - same idea, different API, not separately
stress-tested beyond compiling and being structurally identical to the `sidecar()` path above.
Code-signing and auto-update remain completely untouched. The actual bundling step
(`cargo tauri build`) is covered next - it found a real bug `cargo build` never could.

### Actually bundled and installed with `cargo tauri build` - and a real bug it found

Everything above was still `cargo build` + running the raw binary from `target/debug/` - never
the real packaging command, and never a real install. That gap is closed too: installed the
`tauri-cli` (`cargo install tauri-cli --version "^2.0.0"`), set `bundle.active: true` and
`bundle.targets: ["deb"]` in `tauri.conf.json` (plus `bundle.icon`, which Tauri's bundler
requires explicitly - the dev-mode `cargo build` path never asked for it), and ran
`cargo tauri build --bundles deb`.

**It worked, genuinely**: a 44.5 MiB `.deb` came out, and `dpkg --contents` confirms the sidecar
binary is really inside it as an ordinary installed file, not just referenced:

```
usr/bin/tauri_poc_shell      14.9 MB
usr/bin/sidecar-bin         123.9 MB   <- the SEA binary, renamed from sidecar-bin-<triple>
usr/share/applications/tauri-poc-shell.desktop
usr/share/icons/hicolor/256x256/apps/tauri_poc_shell.png
```

Installed it for real with `dpkg -i` (not just unpacked - a real `apt`/`dpkg` install,
registered in the package database) and ran `/usr/bin/tauri_poc_shell` directly, from `/tmp`,
with none of this PoC's source tree on the path anywhere.

**It crashed on first launch.** Not a cosmetic issue - the sidecar died immediately:

```
Error: Project name could not be inferred. Please specify the `projectName` option.
    at new Conf (dist/sidecar.cjs:10010:19)
    at new ElectronStore (dist/sidecar.cjs:10437:9)
```

This is exactly the kind of thing this whole PoC methodology exists to catch: every earlier
check in this README ran the sidecar from inside the source checkout, where `conf` (the package
behind `electron-store`) could silently find *some* `package.json` nearby and infer a project
name from it when its own Electron-detection failed over to that fallback - the "harmless for
this PoC" wrinkle already documented under "Findings" below. Once genuinely installed to
`/usr/bin`, with no `package.json` anywhere nearby, that fallback has nothing to find and
throws instead of silently working. The gap between "runs from a checkout" and "runs once
installed" was real, and only running the actual installed binary surfaced it.

**Root cause, traced into `electron-store`'s own source** (`node_modules/electron-store/index.js`):
its constructor only uses `app.getPath('userData')` as the data directory when **both**
`ipcMain` and `app` are truthy (`else if (ipcMain && app) { defaultCwd = app.getPath('userData') }`) -
otherwise `cwd` is left `undefined` and `conf` falls through to its own broken inference.
`electronShim.ts` only ever exported `app`, never `ipcMain`, so that branch was always being
skipped - the shim's `getPath('userData')` value was being computed correctly and then never
used, every single time, including in every earlier check in this README that happened to still
work.

**Fixed entirely inside `electronShim.ts` - no change to the real `store.ts` needed**: added a
minimal `ipcMain` stub (just a no-op `.on()`, enough to satisfy `electron-store`'s own internal
`ipcMain.on('electron-store-get-data', ...)` registration) and an `app.getVersion()` stub
(also called in that same code path). That's the one-line condition electron-store actually
checks - once `ipcMain` exists, it takes the `app.getPath('userData')` branch as intended, and
the separately-documented "electron-store's own fallback" wrinkle is now also fully resolved as
a side effect, not just "harmless."

**Confirmed, not just patched**: rebuilt, reinstalled the `.deb` (`dpkg -i` over the broken one),
and reran `/usr/bin/tauri_poc_shell` from `/tmp` again. Clean `sidecar: ready`, no errors. Both
the read path (screenshot, `Got 0 profile(s)...`) and the write + full migration pipeline
(temporary `setTimeout` trigger, reverted before committing, checked against
`~/.tauri-poc-bober-manager/config.json`) were re-verified against the actually-installed
binary, not the dev build.

## Findings from actually running this, not from reading docs

- **Tauri event names reject dots.** `app.emit("profiles.changed", ...)` fails at runtime with
  `only alphanumeric, '-', '/', ':', '_' permitted for event names` - caught immediately
  because the whole call is wrapped and logged rather than ignored (see `main.rs`). Renamed to
  `profiles-changed`. A real migration would need this as a known constraint when choosing
  event names for every IPC channel being ported, not just this one.
- **~~`electron-store`'s own "am I really in Electron" check ignores a stubbed `app.getPath`~~ -
  root-caused and fixed, not just worked around.** The first write landed at
  `~/.config/ark-server-manager-nodejs/config.json` - not `electronShim.ts`'s intended
  `~/.tauri-poc-bober-manager`. Originally documented as "harmless for this PoC" (the data still
  round-tripped, just to the wrong directory) - that assessment didn't survive contact with a
  real install: see "Actually bundled and installed with `cargo tauri build`" above, where the
  exact same root cause crashed the sidecar outright once there was no `package.json` nearby for
  `conf`'s fallback to find. Traced into `electron-store`'s actual source
  (`node_modules/electron-store/index.js`): it only uses `app.getPath('userData')` when
  **both** `ipcMain` and `app` are truthy, and `electronShim.ts` only ever exported `app`.
  Fixed with a minimal `ipcMain` stub in the shim itself - zero changes to the real `store.ts`.
  Worth contrasting with `lib/managerLog.ts`'s own `getDataDir()` → `app.getPath('documents')`
  call, which *did* go through the shim correctly from the start (confirmed: a real `log.record`
  call landed at `~/Documents/ARK Server Manager/logs/manager.jsonl`, exactly where
  `electronShim.ts` says it should) - this quirk was specific to `electron-store`'s own
  Electron-detection logic, not a general problem with stubbing `app.getPath`.
- **A JSON-RPC response needs a concrete, non-`undefined` result.** `log.record`'s handler
  originally returned whatever `logManagerEvent(...)` resolves to, which is `void` -
  `JSON.stringify({ id, result: undefined })` silently drops the `result` key entirely, leaving
  a response line with neither `result` nor `error`, which Rust's `RpcResponse` (at the time,
  no `#[serde(default)]` on either field) would fail to deserialize. Fixed two ways: the
  handler now returns `{ ok: true }` instead of the bare promise result, and `RpcResponse`'s
  fields got `#[serde(default)]` as a second line of defense for any future handler that makes
  the same mistake.
- **esbuild doesn't resolve the project's own `@shared/*` tsconfig path alias on its own.**
  Bundling `serverProcess.ts`/`logEvents.ts` (needed for the console feed) failed outright -
  `Could not resolve "@shared/types"`/`"@shared/games"` - the instant they were imported,
  because esbuild has no built-in tsconfig-paths support; it needs to be told explicitly. Fixed
  by pointing esbuild's own `tsconfig` option at the project's real `tsconfig.node.json`
  (reusing the existing mapping as the source of truth) rather than hand-declaring
  `@shared/*` → `shared/*` a second time in `build.mjs`, which could drift from the real one. A
  real migration bundling more of `src/main/lib/` would hit this on the first file that uses
  the alias, not something specific to these two files.

## What this doesn't prove yet

- **~~Nothing about Windows specifically~~ - now built and run on real Windows too.** Confirmed
  working end to end (read, write, push event, all visually) via WebView2, after fixing two
  Windows-only build issues this surfaced: the MSVC linker (`error: linker 'link.exe' not
  found` without the "Desktop development with C++" Build Tools workload) and a missing
  `icons/icon.ico` (see "Running it"). The RAM numbers below are still Linux-only, though -
  that specific measurement still needs a real run on the Windows machine to mean anything.
- **~~Nothing about streaming~~ - the live console feed itself is now covered**, via the real
  `watchLogFile`/`parseLogChunkWithDate` (see "Result" above) - the stdin/stdout JSON-RPC shape
  does carry a continuous stream of small push events correctly, not just a single
  "entity changed" event. Still nothing about the other ~33 IPC modules specifically (group
  console, stats history, Discord bot status, ...), though they're the same two shapes
  (request/response or push) this PoC has now exercised at least once each.
- **~~Nothing about packaging/bundling the sidecar~~ - all three parts now proven**: the sidecar
  runs as one self-contained executable with no system `node` dependency (Node SEA); it's
  spawned through Tauri's real `bundle.externalBin`/`tauri-plugin-shell` sidecar mechanism, not
  a hardcoded path; and `cargo tauri build --bundles deb` genuinely bundles it into an
  installable `.deb` that runs correctly once `dpkg -i`'d for real - see "Sidecar packaging"
  above, specifically "Actually bundled and installed with `cargo tauri build`", which is also
  where a real crash-on-fresh-install bug got found and fixed. Still outstanding: code-signing
  and auto-update, and the equivalent bundling step on Windows (`.msi`/`.exe` via WiX/NSIS) and
  macOS (`.app`/`.dmg`) - only the Linux `.deb` target has been tried. `SIDECAR_PATH` is still a
  dev-time escape hatch for iterating without rebuilding the SEA binary each time.
- **~~Nothing about `shell.*` calls~~ - proven for `shell.openPath`, the only one any real file
  uses.** See "The reverse direction" above: the sidecar can call back into Rust for a real
  native action and get a real result (success or a real error string) back, through the same
  stdio pipe, with no change to the real file that calls it (`lib/systemFolders.ts`'s
  `openProfilesFolder()`, unmodified). This actually overturns this PoC's own earlier
  speculation in the table below - see the note under it.
- **~~Nothing about the bot sidecar~~ - proven, including a real bug and a validated fix.** See
  "The Discord bot subsystem" above: `lib/discordBot.ts` + `src/bot/` have no Electron coupling
  at all - but `fork()` silently can't spawn a different script from a Node SEA binary (it just
  relaunches the SEA binary's own embedded entry point instead), which would have broken the bot
  subsystem the moment the main sidecar ships as a SEA binary. Fixed with a small, tested,
  opt-in change to the real `discordBot.ts` (15 lines, zero behavior change when unset, existing
  test suite still green) - the *one* real file this whole PoC needed to actually modify, not
  just call unmodified.
- **~~Nothing about the webdashboard sidecar~~ - proven, and it isn't actually a separate
  sidecar at all.** See "The web dashboard subsystem" above: `lib/webDashboard.ts` (8200+
  lines) is an in-process `http.Server`/`https.Server` even in the real app, not a forked
  process like the bot, so none of the SEA/`fork()` problem applies. Confirmed with a real HTTP
  client against the real embedded dashboard page and a real `/api/servers` response, both
  standalone and through the actual compiled app via plain `curl` - and unlike the bot, nothing
  broke; it bundled and ran correctly on the first try despite pulling in a large slice of
  `src/main/lib/` transitively. All three subsystems from the original size estimate (main
  process logic, bot, web dashboard) are now proven.
- **~~Nothing about the real renderer~~ - proven for two real, unmodified pages, one read-only and
  one a write path.** See "A real React page" and "A second real page" above:
  `ManagerLogView.tsx` (read-only) and `ProfileManagementView.tsx` (copy/move + a native dialog),
  both completely unmodified, render correctly against a `window.api` shim built to the same
  surface the real preload already exposes, backed by Tauri's `invoke`/`listen` instead of
  Electron's `contextBridge`. Confirmed with real seeded/moved data through the real compiled
  app, screenshotted (including catching and fixing a wrapper-only mount-order bug the second
  page's screenshot surfaced - see "A second real page"). Still nothing about the rest of the
  real renderer - `App.tsx`'s routing/layout, Context providers, or any of the other ~28 pages,
  each touching a different (and in several cases much larger) slice of `window.api` than these
  two do - two pages confirm the *shape* of the port generalizes past the easiest case, not that
  every page ports this cheaply.
- **~~Nothing about native OS dialogs~~ - proven architecturally, not proven end-to-end in this
  sandbox.** See "A second real page" above: `dialog_select_directory` is wired correctly (the
  command registers, compiles, and calling it visibly does something - a real dialog attempt, not
  a no-op), and it's the right architectural shape (a Rust-only command, matching the real
  `dialog.ts`'s own main-process-only design, no sidecar involved). What's unconfirmed is the
  happy path itself: `tauri-plugin-dialog`'s `blocking_pick_folder()` blocks indefinitely in this
  headless Xvfb sandbox waiting for a human click that can't happen unattended, unlike
  `shell.openPath`'s clean, fast failure. Needs a real desktop session (the same way the Windows
  numbers above needed a real machine) to confirm a folder actually gets picked and returned.
- **~~Nothing about starting/stopping a real server process~~ - proven, standalone and through
  the real compiled app.** See "The actual headline case" above: `startServer()`/`stopServer()`/
  `getStatus()` from `lib/serverProcess.ts` (980 lines, completely untouched until this round)
  spawn, track, and shut down a real OS process with no Electron coupling to shim at all. No real
  ARK/Minecraft dedicated server binary exists in this sandbox, so a test-only stand-in script
  stood in for one at the real, unmodified `getExecutablePath()`'s resolved path - confirmed with
  a genuine spawned PID, the real launch command line from `buildLaunchArgs()`, real
  `server-status` push events, and a real graceful-then-SIGTERM shutdown that left no orphaned
  process behind, both standalone (piping JSON-RPC directly into the SEA binary) and through the
  actual compiled Tauri app under Xvfb (confirmed via the real OS process list appearing then
  disappearing, not a screenshot). Found one real property of the unmodified shutdown code along
  the way: `stopServer()`'s "force kill" is a single SIGTERM with a 10-second give-up, not an
  escalation to SIGKILL - a process that ignored SIGTERM would be reported `stopped` without
  actually being dead. Still unconfirmed: `adoptPersistedProcesses` (reattaching to a pid across
  app restarts - not wired into this PoC's `main()`), the staggered multi-server spawn queue, the
  `watchLogFileForMarker`-based "fully started" detection (never reachable without a real server
  actually logging its own startup), the Windows-only ARK: Survival Evolved `.bat`-launch path,
  and no UI page calls any of this yet - `Dashboard.tsx` (758 lines, the real Start/Stop/Restart
  buttons) is out of scope for this round, which proved the RPC layer first, same order
  bot/web-dashboard were proven in before any UI touched them.

## Where the real Electron coupling lives

Only two files are touched by Electron's `app` module in the startup path this PoC actually
exercises: `src/main/lib/dataDir.ts` (`app.getPath('documents')`) and `electron-store`'s own
internal default (`app.getPath('userData')`), both satisfied by `sidecar/electronShim.ts`'s
two-line stand-in.

A quick `grep -rl "from 'electron'" src/main/lib/` turns up 12 files total (out of ~80 in that
directory) - a cheap, worthwhile sanity check before assuming "keep 100% of the business logic"
is realistic beyond this one PoC's slice:

| What it imports | Files | Sidecar-portable? |
| --- | --- | --- |
| `app` (`getPath`/`isPackaged`) | `dataDir.ts`, `appUpdater.ts`, `discordBot.ts`, `launchOnStartup.ts`, `webDashboard.ts`, `systemFolders.ts` | Yes - same `electronShim.ts` pattern as this PoC already proves |
| `shell` (`openPath` - `showItemInFolder` isn't actually called anywhere) | `backup.ts`, `mapManagement.ts`, `minecraftBackup.ts`, `minecraftMods.ts`, `playerBackup.ts`, `systemFolders.ts` | ~~Needs a real native call, not a stub - these particular calls would need to move to a Tauri command instead of staying in these files as-is~~ **Proven wrong by building it: sidecar-portable too, with zero changes to these files** - see "The reverse direction" above |
| `BrowserWindow` (type only) | `windowFocus.ts` | N/A - window-focus logic belongs in the shell anyway, not a sidecar concern |

So the actual finding is better than "two files": every `app.*` use across the whole `lib/`
directory is the same shape this PoC already handles, and every `shell.*` use turns out to be
the same shape too, once there's a real bidirectional channel - this table's own first guess
(struck through above rather than deleted) assumed `shell.*` call sites would need to move out
of these files and into a Tauri command, because "only the Rust shell can make the native
call." Building it showed that's not actually required: `electronShim.ts`'s `shell.openPath`
round-trips to Rust transparently, so `backup.ts`/`mapManagement.ts`/etc. would port completely
unmodified, exactly like every `app.*`-shaped file above - worth keeping the wrong guess
visible, not just the corrected answer.
