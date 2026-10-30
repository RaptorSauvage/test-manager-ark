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
way, see "The Discord bot subsystem" below. Window chrome, the menu bar, the tray, and the other
~34 IPC modules in `src/main/ipc/` are still deliberately out of scope.

## What's here

- `src-tauri/` - a minimal Tauri 2 app, using `tauri-plugin-shell`'s real sidecar mechanism (not
  a hand-rolled `std::process::Command`) to spawn the sidecar on startup - see "Sidecar
  packaging" below. `src/main.rs` keeps a background async task reading the sidecar's stdout
  that routes each line either to the pending `call()` it answers (has an `"id"`), a
  `"shell-request"` (the sidecar calling back into Rust - see "The reverse direction" below), or
  out to the webview as an ordinary Tauri event (any other `"event"`), and exposes ten Tauri
  commands: `profiles_list`, `profiles_save` (takes a profile object), `log_record` (takes a
  message string), `console_backlog`/`console_watch` (both take an `installDir`),
  `console_append_test_line` (test-only - see below), `folders_open_profiles`, and
  `bot_start`/`bot_stop`/`bot_status` (see "The Discord bot subsystem" below).
- `sidecar/sidecar.ts` - a newline-delimited-JSON RPC server over stdin/stdout. Imports
  `listProfiles`/`saveProfile`/`profileEvents` from **the real, untouched `src/main/store.ts`**,
  `logManagerEvent`/`managerLogEvents` from **the real, untouched
  `src/main/lib/managerLog.ts`**, `watchLogFile`/`getLogFilePath` (from
  **`src/main/lib/serverProcess.ts`**) plus `readLogBacklog`/`parseLogChunkWithDate`/
  `createLogEventCaches` (from **`src/main/lib/logEvents.ts`**), `openProfilesFolder` (from
  **`src/main/lib/systemFolders.ts`**), and `startDiscordBot`/`stopDiscordBot`/
  `getDiscordBotStatus` (from **`src/main/lib/discordBot.ts`**, see "The Discord bot subsystem"
  below) - none of it stubs or rewrites; every emitter is wired
  straight to a push-event line (`profiles-changed`, `manager-log-entry`, `console-line`), so
  every real write's/parsed log line's side effect reaches the webview the same way it would via
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
  expects.
- `frontend/index.html` - a bare page (not the real React UI): calls `invoke('profiles_list')`
  on load; buttons call `invoke('profiles_save', { profile })`, `invoke('log_record', {
  message })`, `invoke('console_watch', { installDir })`, `invoke('console_append_test_line',
  { installDir, message })`, `invoke('folders_open_profiles')`, and `invoke('bot_start')`/
  `invoke('bot_stop')`/`invoke('bot_status')`; `listen('profiles-changed',
  ...)`/`listen('manager-log-entry', ...)`/`listen('console-line', ...)` handlers update their
  own section the moment each push event arrives - independent of any button, proving the
  live-update path for all three.

## Running it

```sh
node sidecar/build-bot.mjs    # bundles sidecar/bot/index.js (needed before the first bot_start call)
node sidecar/build.mjs        # bundles sidecar/dist/sidecar.cjs
node sidecar/build-sea.mjs    # builds dist/sidecar-bin AND copies it into src-tauri/binaries/
cd src-tauri && cargo build   # or: cargo tauri dev, if the Tauri CLI is installed
./target/debug/tauri_poc_shell
```

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

### The Discord bot subsystem (and a real packaging bug it found)

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
A real migration shipping the main-process sidecar as a SEA binary would need to address this
specifically before the bot subsystem could ship the same way - options include giving
`lib/discordBot.ts`'s launch mechanism a pluggable target (an env var or config value naming an
explicit bot binary/script path, the same escape-hatch shape `SIDECAR_PATH` already is for this
PoC) rather than always re-executing `process.execPath`, or shipping the bot as its own
separate SEA binary and spawning that specific path with `child_process.spawn` instead of
`fork()`. Neither is attempted here - this PoC's job was finding the problem, not fixing
`discordBot.ts`, which would mean modifying a file this whole PoC otherwise proves can stay
untouched.

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
Three sidecars (main process logic, bot, webdashboard - see "What this doesn't prove yet") built
this way, each embedding its own full Node copy, would start to erode the size advantage this
whole migration is supposed to deliver - worth weighing against a single shared sidecar process
serving all three roles instead of one SEA binary per role.

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
- **~~Nothing about the bot sidecar~~ - proven, and it needed zero porting work.** See "The
  Discord bot subsystem" above: `lib/discordBot.ts` + `src/bot/` have no Electron coupling at
  all and ported completely unmodified - but this also found a real, serious bug: `fork()`
  silently can't spawn a different script from a Node SEA binary (it just relaunches the SEA
  binary's own embedded entry point instead), which a real migration shipping the main sidecar
  as a SEA binary would need to solve before the bot subsystem could ship the same way. **Still
  nothing about the webdashboard sidecar** - not yet touched.

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
