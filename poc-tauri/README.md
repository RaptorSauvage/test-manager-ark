# Tauri shell PoC

Answers one question before committing to a real Electron → Tauri migration: can a Rust shell
spawn and talk to a persistent Node sidecar running the **existing, unmodified** application
logic, and get a real result back into a Tauri webview through an ordinary `invoke()` call?

This is scoped to exactly that round trip, now covering three shapes rather than one: a plain
read (`profiles.list`), a write with parameters (`profiles.save`), and an unsolicited push event
reaching the webview without it having asked (`profiles-changed`, wrapping `store.ts`'s own
`profileEvents` emitter) - the last one matters because most of the real app's IPC (console
output, status changes, ...) is push-shaped, not request/response. Window chrome, the menu bar,
the tray, and the other ~34 IPC modules in `src/main/ipc/` are still deliberately out of scope.

## What's here

- `src-tauri/` - a minimal Tauri 2 app. `src/main.rs` spawns the sidecar as a child process on
  startup, keeps a reader thread on its stdout that routes each line either to the pending
  `call()` it answers (has an `"id"`) or out to the webview as a Tauri event (has an
  `"event"` instead), and exposes two Tauri commands: `profiles_list` and `profiles_save`
  (takes a profile object as its param).
- `sidecar/sidecar.ts` - a newline-delimited-JSON RPC server over stdin/stdout. Imports
  `listProfiles`, `saveProfile`, and `profileEvents` from **the real, untouched
  `src/main/store.ts`** - not a stub or a rewrite; `profileEvents.on('changed', ...)` is wired
  straight to a push-event line, so every real write's side effect reaches the webview the same
  way it would via Electron's `webContents.send`. `sidecar/electronShim.ts` stands in for the
  one Electron API that import chain actually calls directly (`app.getPath`) - see "electron-
  store's own fallback" below for a wrinkle this found. `sidecar/build.mjs` bundles it with
  esbuild, aliasing `electron` → the shim, into a single dependency-free `dist/sidecar.cjs`.
- `frontend/index.html` - a bare page (not the real React UI): calls `invoke('profiles_list')`
  on load, a button calls `invoke('profiles_save', { profile })` with a hardcoded test profile,
  and a `listen('profiles-changed', ...)` handler re-renders the list the moment that push event
  arrives - independent of the button, proving the live-update path.

## Running it

```sh
node sidecar/build.mjs        # bundles sidecar/dist/sidecar.cjs
cd src-tauri && cargo build   # or: cargo tauri dev, if the Tauri CLI is installed
./target/debug/tauri_poc_shell
```

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

Screenshot of the read path (Linux, WebKitGTK, via Xvfb - `Got 0 profile(s)` because this
sandbox has no real profiles.json, not because anything failed):

`Tauri shell PoC - real store.ts through a Node sidecar` / `Got 0 profile(s) from the real
store.ts, via the Rust shell -> Node sidecar round trip.`

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

## Two more findings from actually running this, not from reading docs

- **Tauri event names reject dots.** `app.emit("profiles.changed", ...)` fails at runtime with
  `only alphanumeric, '-', '/', ':', '_' permitted for event names` - caught immediately
  because the whole call is wrapped and logged rather than ignored (see `main.rs`). Renamed to
  `profiles-changed`. A real migration would need this as a known constraint when choosing
  event names for every IPC channel being ported, not just this one.
- **`electron-store`'s own "am I really in Electron" check ignores a stubbed `app.getPath`.**
  The first write landed at `~/.config/ark-server-manager-nodejs/config.json` - not
  `electronShim.ts`'s intended `~/.tauri-poc-bober-manager`. `electron-store` has its own
  internal detection for whether it's genuinely running inside Electron, and outside of that it
  falls back to resolving a data directory from the nearest `package.json`'s `name` field via
  `env-paths`, bypassing `app.getPath('userData')` entirely regardless of what the shim returns.
  Harmless for this PoC (the data still round-trips correctly, just not to the directory this
  PoC expected), but worth knowing for real: controlling where a sidecar's `electron-store` data
  lands needs either `cwd` passed explicitly to `new Store(...)` in `store.ts` itself (a tiny,
  low-risk change, and arguably the more correct fix regardless of Tauri) or accepting
  `electron-store`'s own fallback location when running outside Electron.

## What this doesn't prove yet

- **~~Nothing about Windows specifically~~ - now built and run on real Windows too.** Confirmed
  working end to end (read, write, push event, all visually) via WebView2, after fixing two
  Windows-only build issues this surfaced: the MSVC linker (`error: linker 'link.exe' not
  found` without the "Desktop development with C++" Build Tools workload) and a missing
  `icons/icon.ico` (see "Running it"). The RAM numbers below are still Linux-only, though -
  that specific measurement still needs a real run on the Windows machine to mean anything.
- **Nothing about the other ~34 IPC modules.** `profiles.list` is a simple synchronous read.
  Several existing IPC handlers stream events to the renderer continuously (console output,
  group console, stats history, Discord bot status, ...) rather than request/respond once -
  the stdin/stdout JSON-RPC shape here would need a server-push side (or a persistent
  WebSocket/local-TCP channel instead of stdio) to carry those, which this PoC doesn't attempt.
- **Nothing about packaging/bundling the sidecar as a real Tauri resource**, code-signing, or
  auto-update - `SIDECAR_PATH` here is a dev-time escape hatch pointing at a source-tree path,
  not how a shipped build would locate it.
- **Nothing about the bot/webdashboard sidecars** mentioned in the original size estimate - this
  PoC only touches the "main process logic" sidecar.

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
| `shell` (`openPath`/`showItemInFolder`) | `backup.ts`, `mapManagement.ts`, `minecraftBackup.ts`, `minecraftMods.ts`, `playerBackup.ts`, `systemFolders.ts` | Needs a real native call, not a stub - Tauri has an equivalent (`opener` plugin) but it lives in the Rust shell, not the sidecar, so these particular calls would need to move to a Tauri command instead of staying in these files as-is |
| `BrowserWindow` (type only) | `windowFocus.ts` | N/A - window-focus logic belongs in the shell anyway, not a sidecar concern |

So the actual finding is better than "two files": every `app.*` use across the whole `lib/`
directory is the same shape this PoC already handles, and every `shell.*` use is a small,
identifiable list of call sites (not business logic itself) that a real migration would route
to a Tauri command instead of stubbing - a bounded, scoped follow-up, not an open-ended one.
