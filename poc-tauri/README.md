# Tauri shell PoC

Answers one question before committing to a real Electron → Tauri migration: can a Rust shell
spawn and talk to a persistent Node sidecar running the **existing, unmodified** application
logic, and get a real result back into a Tauri webview through an ordinary `invoke()` call?

This is scoped to exactly that round trip. Window chrome, the menu bar, the tray, and the other
~34 IPC modules in `src/main/ipc/` are deliberately out of scope - this only wires up one real
call (`profiles.list`) to prove the architecture, not to replace anything yet.

## What's here

- `src-tauri/` - a minimal Tauri 2 app. `src/main.rs` spawns the sidecar as a child process on
  startup, keeps a reader thread on its stdout, and exposes one Tauri command
  (`profiles_list`) that round-trips a request/response over the sidecar's stdin/stdout.
- `sidecar/sidecar.ts` - a newline-delimited-JSON RPC server over stdin/stdout. Imports
  `listProfiles` from **the real, untouched `src/main/store.ts`** - not a stub or a rewrite.
  `sidecar/electronShim.ts` stands in for the one Electron API that import chain actually
  needs (`app.getPath`), since `store.ts` (via `electron-store`) and `lib/dataDir.ts` both
  assume they're running inside Electron's own process. `sidecar/build.mjs` bundles it with
  esbuild, aliasing `electron` → the shim, into a single dependency-free `dist/sidecar.cjs`.
- `frontend/index.html` - a bare page (not the real React UI) that calls
  `invoke('profiles_list')` and renders whatever comes back, just to prove the webview side of
  the round trip works too.

## Running it

```sh
node sidecar/build.mjs        # bundles sidecar/dist/sidecar.cjs
cd src-tauri && cargo build   # or: cargo tauri dev, if the Tauri CLI is installed
./target/debug/tauri_poc_shell
```

Linux build needs `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `libsoup-3.0-dev`,
`libjavascriptcoregtk-4.1-dev`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, and
the usual `build-essential`. Windows needs the Tauri prerequisites (MSVC build tools, WebView2
- present by default on Windows 10 21H2+/11) instead; this PoC has only been run on Linux so
far (see "what this doesn't prove" below).

## Result

The round trip works end to end: the webview calls `invoke('profiles_list')` → Rust writes a
JSON-RPC request to the sidecar's stdin → the sidecar runs the real `listProfiles()` (full
`electron-store` load, migrations, everything `store.ts` normally does) → the response comes
back over stdout → Rust resolves the pending call → the webview renders it. No code in
`src/main/store.ts` was changed for this to work - only `app.getPath('documents')` needed a
stand-in to run outside Electron.

Screenshot (Linux, WebKitGTK, via Xvfb - `Got 0 profile(s)` because this sandbox has no real
profiles.json, not because anything failed):

`Tauri shell PoC - real profiles.list() through a Node sidecar` / `Got 0 profile(s) from the
real store.ts, via the Rust shell -> Node sidecar round trip.`

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

## What this doesn't prove yet

- **Nothing about Windows specifically.** Built and run on Linux only, in this sandbox, because
  that's what's available here. Tauri's Windows target uses WebView2 instead of WebKitGTK -
  architecturally equivalent (an OS-provided webview instead of a bundled Chromium), but not
  verified firsthand. The next real step is building this same PoC on a Windows machine before
  trusting the RAM numbers at all, and before deciding anything about MSVC/WebView2 edge cases.
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
