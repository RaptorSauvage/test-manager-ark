# ARK Server Manager

A small desktop app (Electron + React + TypeScript) for controlling ARK: Survival Ascended
dedicated servers running on the same machine.

## Features

- **Start / stop / restart / kill** one or more server profiles (each profile is an
  independent ARK:SA server install/instance). Stop and restart send RCON `SaveWorld`,
  wait for its confirmation, then `DoExit`; Kill force-terminates the process immediately
  with no save, for when a server is stuck. The status badge tracks the OS process
  (`starting`), the server actually finishing loading - detected by polling its own log
  file (`ShooterGame/Saved/Logs/ShooterGame.log`) for the
  `Server has completed startup and is now advertising for join` line, since ARK's
  dedicated server allocates its own console on Windows instead of writing through the
  standard stdout handle a piped process would normally use - (`running`), and a distinct
  `restarting` phase for the shutdown half of a restart, so it never claims "running"
  before the world has actually loaded or while it's mid-restart.
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
  actions, instead of being split off into Settings. A scheduled backup only actually runs
  while the server is online - if it's stopped when the cron fires, that run is skipped
  rather than backing up (or erroring on) a server that isn't running.
- **Monitoring** — CPU/RAM usage and connected player count while a server is running.
- **Dashboard** — server cards can be dragged (via the ⠿ handle) into any order you like;
  the order is persisted and stays the same next time you open the app.
- **Export / import a profile as a file** — a server's Settings tab has an "Export
  profile..." button that saves its whole config (ports, mods, cluster, extra settings -
  everything except backups/logs) as a JSON file; the dashboard's "Import profile file..."
  button loads one back in as a new profile (a fresh id, deduplicated name if it collides
  with an existing one, and run through the same migration as profiles loaded from the
  store, so a file exported by an older version of the app still imports cleanly).
- **Server Controls** — bulk actions across every profile at once: Start All, Restart All,
  and Stop All only touch the profiles actually in the relevant state (e.g. Restart All
  skips already-stopped servers). Update All updates every stopped server in parallel
  (each is a separate anonymous-login SteamCMD process, so this is safe). Stop+Update+
  Restart All stops whichever servers are currently running, updates every profile, then
  starts back up only the ones that were running beforehand. Each server's "View update
  log" button shows the last SteamCMD run's output (logged to
  `logs/steamcmd-update-<profileId>.log` next to the Manager), so an update failure is
  diagnosable instead of just a raw exit code. SteamCMD's own piped console output is
  known to be unreliable on Windows and often carries nothing useful, so this log also
  includes whatever SteamCMD wrote to its own `logs/content_log.txt` (next to the
  SteamCMD executable) during that run. Before each update, a stuck
  `steamapps/appmanifest_2430930.acf` (SteamCMD's documented "StateFlags 6" state - it
  otherwise makes every later attempt fail instantly with the same error, regardless of
  whether the original problem is still there) is detected and deleted automatically so
  the update can actually run. After the run, the manifest is also checked to decide
  success/failure alongside the process's own exit code - SteamCMD can relaunch itself
  mid-run to self-update, and the originally spawned process (the one whose exit code gets
  tracked) can then exit with a stale/misleading non-zero code even though the whole chain
  went on to complete successfully afterwards; if the manifest shows no update pending,
  that's treated as success regardless.
- **Add firewall rule for SteamCMD** (SteamCMD menu, Windows only) — adds Windows Firewall
  allow rules (inbound + outbound) for whichever `steamcmd.exe` is configured above, useful
  if update failures turn out to be network-related. Prompts once for admin rights (UAC)
  just for that action - the app itself keeps running unelevated the rest of the time.
- **Cluster** — an optional, per-server section (Settings tab) for cross-server transfers:
  Cluster ID (`-clusterid=`), Dedicated Cluster Directory (`-ClusterDirOverride=`, with a
  folder picker), No Transfer From Filtering (`-NoTransferFromFiltering`), and External IP
  (`-ServerIP=`). All four only apply when the section's enable checkbox is on, and are
  placed before "Extra launch arguments" in the final command line.
- **Server Platform** — PC or ALL (crossplay), passed as `-ServerPlatform=`.
- **Max Players** — passed as `-WinLiveMaxPlayers=` (defaults to 70).
- **Extra Settings** (Settings tab) — Culture Settings (None/English/French, passed as
  `-culture=en`/`-culture=fr`, omitted entirely when set to None), Disable BattlEye
  (`-NoBattlEye`), RCON Tribe Log (`-servergamelogincludetribelogs` +
  `-ServerRCONOutputTribeLogs`), Force Respawn Wild Dinos (`-ForceRespawnDinos`), and No
  Sound (`-nosound`). This section also shows an always-on, non-interactive "RCON Enabled"
  indicator - RCON can't actually be turned off since the Manager depends on it for
  Stop/Restart and the RCON tab.
- **Update / install via SteamCMD** — a per-server button runs
  `steamcmd +force_install_dir <install dir> +login anonymous +app_update 2430930 validate +quit`.
  Works for a first-time install into an empty folder too - the button reads **Install**
  instead of **Update** until the server executable is actually found in the install
  directory, then switches over automatically. Disabled while the server is running or
  already updating. The dashboard's own **SteamCMD** menu can either download and
  manage its own SteamCMD copy (one click, no setup) or point at an existing install you
  already have. The managed copy installs into a `steamcmd` folder next to the Manager
  itself (next to the executable when packaged, or the project root in dev) - not a hidden
  OS app-data folder - so it's easy to find on disk.

## Prerequisites

- Node.js 20+
- SteamCMD, only if you want to use the in-app Update button: either let the app install
  its own copy from the dashboard's **SteamCMD** menu, or point SteamCMD path there at an
  existing `steamcmd.exe`/`steamcmd.sh`. Otherwise you can keep managing installs yourself and just
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
npm test             # unit tests for the pure logic (launch args incl. cluster flags, RCON parsing, backup rotation, profile migration, SteamCMD args/paths, process adoption, startup log-file watching)
npm run dist          # package a Windows installer + portable .exe into release/ (must be run on Windows)
```

`npm run dist` produces both an NSIS installer and a standalone portable `.exe` (via
`electron-builder`) in `release/`. It has to run on an actual Windows machine - cross-
building Windows targets from Linux/macOS needs Wine for the code-signing step, which
isn't set up here. The portable `.exe` is the easiest way to right-click → "Run as
administrator" without installing anything.

## Setting up a server profile

From the dashboard, click **+ Add server**, then open it and fill in the **Settings**
tab:

- **Install directory**: the folder containing `ShooterGame/Binaries/...` for that
  server instance.
- **Map**, **game/RCON ports**, and **Server Platform** (PC/ALL). RCON authenticates using
  `ServerAdminPassword` from that install's `GameUserSettings.ini` - set it there, not in
  this app - and must be reachable on `127.0.0.1` (start/stop rely on it to save the world
  before shutting down).
- Backups always read/write `ShooterGame/Saved/SavedArks/<map>` under the install
  directory - only the profile's own map subfolder, not the whole `SavedArks` folder (it
  can hold other maps' saves too, e.g. on a shared cluster install). This location is
  fixed by ARK:SA and isn't a configurable field. Backup directory, retention, and
  scheduling live in the **Backups** tab, not here; you must set a backup directory there
  before creating a backup.

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
- **If Update repeatedly fails** (SteamCMD exit codes 7/8, or "Failed to get manifest
  request code, 'Access Denied'" in the update log) even though the exact same command
  works fine run manually: check that your antivirus (e.g. Malwarebytes) isn't silently
  blocking the Manager's `.exe` and/or `cmd.exe`/`steamcmd.exe` - add an exception for both
  and retry. This was confirmed as the actual root cause in one real case, after disk
  space, admin rights, and a stuck SteamCMD manifest state had all been ruled out first.
