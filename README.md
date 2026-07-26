# ARK Server Manager

A small desktop app (Electron + React + TypeScript) for controlling ARK: Survival Ascended
dedicated servers running on the same machine.

## Features

- **Start / stop / restart / kill** one or more server profiles (each profile is an
  independent ARK:SA server install/instance). Stop and restart send RCON `SaveWorld`,
  wait for its confirmation, then `DoExit`; Kill force-terminates the process immediately
  with no save, for when a server is stuck.
- **Survives the Manager closing or crashing** — the server process is spawned detached
  from the app, so it keeps running either way instead of being torn down with it (the
  default on Windows otherwise). Relaunching the Manager re-detects any server that's
  still running (by pid) and picks it back up under management rather than losing track
  of it or letting you start a conflicting second instance.
- **RCON tab** — send admin commands and see responses. The server's own stdout/stderr is
  intentionally not captured here (ARK's dedicated server already shows it in its own
  console window on Windows), keeping this to just RCON. The RCON/admin password isn't a
  field in this app at all - it's read live from the server's own `GameUserSettings.ini`
  (`ServerAdminPassword`) every time it's needed, since ARK:SA doesn't have a separate
  concept of an "RCON password".
- **Mod manager** — enable/disable/reorder mod IDs and toggle a Dev flag per mod (appends
  `-dev` to load that mod's in-development build), applied via the server's `-mods=`
  launch flag - ARK:SA's only mod mechanism (no Steam Workshop, no GameUserSettings.ini
  involvement). The app never touches your `.ini` files — edit those yourself.
- **Backups tab** — backup directory (with a folder picker), max backups to keep, and
  scheduled automatic backups (gated behind an explicit enable/disable toggle, not just an
  empty/filled cron field) live here alongside the backup list/create/restore/delete
  actions, instead of being split off into Settings.
- **Monitoring** — CPU/RAM usage and connected player count while a server is running.
- **Cluster** — an optional, per-server section (Settings tab) for cross-server transfers:
  Cluster ID (`-clusterid=`), Dedicated Cluster Directory (`-ClusterDirOverride=`, with a
  folder picker), and No Transfer From Filtering (`-NoTransferFromFiltering`). All three
  only apply when the section's enable checkbox is on, and are placed before "Extra
  launch arguments" in the final command line.
- **Server Platform** — PC or ALL (crossplay), passed as `-ServerPlatform=`.
- **Update / install via SteamCMD** — a per-server **Update** button runs
  `steamcmd +force_install_dir <install dir> +login anonymous +app_update 2430930 validate +quit`.
  Works for a first-time install into an empty folder too. Disabled while the server is
  running or already updating. The app's **Settings** screen can either download and
  manage its own SteamCMD copy (one click, no setup) or point at an existing install you
  already have.

## Prerequisites

- Node.js 20+
- SteamCMD, only if you want to use the in-app Update button: either let the app install
  its own copy from Settings, or point Settings → SteamCMD path at an existing
  `steamcmd.exe`/`steamcmd.sh`. Otherwise you can keep managing installs yourself and just
  point a profile's Install directory at an existing one.

## Getting started

```bash
npm install
npm run dev      # launches the app with hot reload
```

Other scripts:

```bash
npm run typecheck   # type-check main/preload/renderer
npm run build        # production build into out/
npm test             # unit tests for the pure logic (launch args incl. cluster flags, RCON parsing, backup rotation, profile migration, SteamCMD args/paths, process adoption)
```

## Setting up a server profile

From the dashboard, click **+ Add server**, then open it and fill in the **Settings**
tab:

- **Install directory**: the folder containing `ShooterGame/Binaries/...` for that
  server instance.
- **Map**, **game/RCON ports**, and **Server Platform** (PC/ALL). RCON authenticates using
  `ServerAdminPassword` from that install's `GameUserSettings.ini` - set it there, not in
  this app - and must be reachable on `127.0.0.1` (start/stop rely on it to save the world
  before shutting down).
- **SavedArks path**: relative to the install directory, defaults to
  `ShooterGame/Saved/SavedArks`.
- Backup directory, retention, and scheduling live in the **Backups** tab, not here.

## Notes / limitations

- Tested with `npm run typecheck`, `npm run build`, and `npm test` in this environment,
  which has no display and no real ARK:SA install — so the actual Electron window and
  real start/stop/RCON/backup behavior against a live server have **not** been visually
  verified. Please run `npm run dev` on your machine, point a profile at a real
  install, and try Start/Stop/RCON/Backup end-to-end.
- The exact ARK launch command-line flags can change between game updates
  (`src/main/lib/serverProcess.ts`, `buildLaunchArgs`); use the profile's "Extra launch
  arguments" field if your install needs something different.
- Out of scope for this version: remote/SSH or Docker-based control, and multi-user/remote
  web access (this is a single-user local desktop app).
- Because the server survives the Manager closing, deleting a profile does **not** stop
  its server if one is running — it only removes the profile from the app. Stop or Kill it
  first if you actually want it gone.
