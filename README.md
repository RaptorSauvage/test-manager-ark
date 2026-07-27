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
- **Mod manager** — a table (Enable/Passive/Dev checkboxes, Mod Name, Mod ID, plus
  reorder/remove) instead of a plain list. Enable/disable/reorder mod IDs and toggle a Dev
  flag per mod (appends `-dev` to load that mod's in-development build); enabled mods are
  applied via the server's `-mods=` launch flag by default, or `-passivemods=` instead if
  Passive is checked for that mod (ARK:SA's only mod mechanisms - no Steam Workshop, no
  GameUserSettings.ini involvement). Each header checkbox toggles that column for every
  mod at once. Mod Name is a free-text label you type in yourself, not looked up
  automatically. The app never touches your `.ini` files — edit those yourself.
  **Export mod list...**/**Import mod list...** save/load the whole table (ids, names,
  enabled/passive/dev flags, and order) as a JSON file - handy for sharing a modpack setup
  between servers. Importing replaces the table in the editor; nothing is persisted until
  you click **Save mods** afterwards.
- **Backups tab** — backup directory (with a folder picker that saves immediately on
  picking a folder, no separate Save click needed for that field specifically - typing a
  path by hand still needs "Save backup settings"), max backups to keep, and scheduled
  automatic backups (gated behind an explicit enable/disable toggle, not just an
  empty/filled cron field) live here, instead of being split off into Settings. A
  scheduled backup only actually runs while the server is online - if it's stopped when
  the cron fires, that run is skipped rather than backing up (or erroring on) a server
  that isn't running. The backup file list is a checkbox-select table (File Name/Creation
  Time, with a header checkbox to select/deselect all) with a toolbar above it - Refresh
  backup file list, Open backup folder (opens the configured backup directory in the OS
  file explorer), Restore selected backup, Delete selected backup(s) - instead of a
  Restore/Delete button pair per row. Multiple backups can be checked at once to delete
  them together; Restore only enables when exactly one is checked, since restoring more
  than one at a time isn't meaningful. The list also reloads itself automatically - both
  when a scheduled/cron backup completes in the background (the main process pushes a
  `backup:created` event for the tab to pick up, so you don't have to click Refresh to see
  it) and right after saving a changed backup directory in this tab, so switching folders
  immediately shows that folder's contents instead of the previous one's.
- **Per-player profile backups** — tails the server's own `ShooterGame.log` for join/leave
  lines (e.g. `LeRaptorSauvage [UniqueNetId:0002dbe9... Platform:None] joined this ARK!`)
  rather than polling RCON, and zips up that player's `<UniqueNetId>.profilebak` file from
  `SavedArks/<map>` (ARK:SA writes this itself, right around both connect and disconnect -
  it's the same content as `.arkprofile` under a different extension, so reading it means
  never having to guess/wait for the live `.arkprofile` to be rewritten) into
  `PlayerBackups/<player>_<id>/` under the backup directory as a small `.zip`, timestamped
  and tagged `_joined`/`_left`, with the `.arkprofile` extension restored on the entry
  inside so it drops back in cleanly if ever extracted. Configured from its own **Player
  Profile Backups** block in the Backups tab, shown side-by-side with the World Backups
  settings block - an enable/disable checkbox (off by default) and a "Backups to keep per
  player" count (default 20, pruning older ones automatically). Toggling the checkbox
  takes effect immediately on an already-running server, not just on its next restart -
  saving the profile re-evaluates the watch right away instead of requiring a Stop/Start.
  The resulting snapshots are managed from a matching **Player Profile Backups** list
  block below (side-by-side with the world backup list) - a player dropdown (with its own
  Refresh) picks whose folder to browse, then the same checkbox-select table/toolbar as
  the world backups (Refresh backup file list, Open backup folder, Restore selected
  backup, Delete selected backup(s)) operates on that player's snapshots specifically.
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
- **Official Server Status** (dashboard sidebar) — fetches Wildcard's official ARK:SA
  server status feed (`https://cdn2.arkdedicated.com/asa/officialserverstatus.ini`).
  Despite the `.ini` extension, the file isn't key/value INI - it's a single line like
  `ARK Official Server Network Status: <RichColor Color="0, 1, 0, 1">Online (v92.25)</>`,
  which is parsed with a dedicated regex into a label, status, version, and the
  `RichColor` (four 0-1 floats, Unreal Engine's usual color format) converted into a CSS
  `rgb()`/`rgba()` color, then shown as "Official Server Network Status : Online
  (92.25)" in that color. A Refresh button re-fetches on demand.
- **Settings** (dashboard) — lets you override the "Data files location" (default:
  Documents/ARK Server Manager), the folder `maps.json`, `customMaps.json`, and any future
  editable config files live in. Changing it only affects where the app looks going
  forward - it doesn't move existing files to the new folder for you.
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
  before shutting down). The Map dropdown is populated from `maps.json` (Documents/ARK
  Server Manager by default - not next to the Manager executable, since electron-builder's
  NSIS installer wipes that folder's contents on every update; Documents is untouched by
  that and by swapping the portable exe) - a seed list of the official maps is created
  there on first run, and a line can be added to that file for any DLC or modded map not
  already listed, no app update needed. A profile's current map is always shown even if it
  isn't (or isn't yet) in that file. A "Refresh" button next to the dropdown reloads the
  file on demand.
- **Custom Map** - a dropdown, right above Mod Map, backed by `customMaps.json` (same
  folder and shape as `maps.json`; the `None` entry - empty id - is part of the file
  itself, seeded on first run, so it's just another editable row rather than a hardcoded
  special case; everything else is added by you, since custom/modded maps are specific to
  whatever Workshop mods you use). Picking an entry sets Mod Map below to that entry's id
  and enables it; picking **None** disables Mod Map and falls back to using the Map
  dropdown above as normal - which is also what actually happens in ARK:SA itself once
  `-MapModID=` is set, since it takes over regardless of the base Map value.
- **Mod Map** - a separate "Enable Modded Map" toggle below Custom Map for Workshop-based
  custom maps: paste the mod's Workshop id (or pick one via Custom Map above) and it's
  passed as `-MapModID=<id>` alongside the regular Map value.
- Backups always read/write `ShooterGame/Saved/SavedArks/<map>` under the install
  directory - only the profile's own map subfolder, not the whole `SavedArks` folder (it
  can hold other maps' saves too, e.g. on a shared cluster install). This location is
  fixed by ARK:SA and isn't a configurable field. `.arkrbf` files (ARK's own transient
  rollback data, not useful in a backup) are left out of the zip. Backup directory,
  retention, and scheduling live in the **Backups** tab, not here; you must set a backup
  directory there before creating a backup.

## Notes / limitations

- Tested with `npm run typecheck`, `npm run build`, and `npm test` in this environment,
  which has no display and no real ARK:SA install — so the actual Electron window and
  real start/stop/RCON/backup behavior against a live server have **not** been visually
  verified. Please run `npm run dev` on your machine, point a profile at a real
  install, and try Start/Stop/RCON/Backup end-to-end.
- The exact ARK launch command-line flags can change between game updates
  (`src/main/lib/serverProcess.ts`, `buildLaunchArgs`); use the profile's "Extra launch
  arguments" field if your install needs something different.
- The player-profile-backup join/leave line format, the ".profilebak filename equals the
  UniqueNetId" mapping, and ARK writing that file itself around both events were all
  confirmed against a real setup, not guessed - but if a future ARK:SA update changes any
  of that, the parser (`parsePlayerConnectionEvents` in
  `src/main/lib/playerConnectionWatcher.ts`) simply stops matching lines and the feature
  quietly does nothing rather than backing up the wrong file.
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
