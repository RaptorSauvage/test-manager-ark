# ARK Server Manager

A small desktop app (Electron + React + TypeScript) for controlling ARK: Survival Ascended
dedicated servers running on the same machine.

## Features

- **Start / stop / restart** one or more server profiles (each profile is an independent
  ARK:SA server install/instance).
- **RCON console** — send admin commands and see responses, plus a live tail of the
  server's stdout/stderr.
- **Config editor** — a form for the common `GameUserSettings.ini` settings (session name,
  passwords, max players, difficulty, XP/taming/harvest multipliers, PvE/PvP), with a raw
  `.ini` editor fallback for anything else, and a mod manager (enable/disable/reorder mod
  IDs, applied via the server's `-mods=` launch flag - ARK:SA's only mod mechanism).
- **Backups** — one-click zip backup of a profile's `SavedArks` folder, automatic pruning
  of old backups, optional cron-based scheduling, and one-click restore.
- **Monitoring** — CPU/RAM usage and connected player count while a server is running.

## Prerequisites

- Node.js 20+
- An existing ARK: Survival Ascended dedicated server install per profile you want to
  manage (this app does not install or update the server itself — see "Out of scope"
  below).

## Getting started

```bash
npm install
npm run dev      # launches the app with hot reload
```

Other scripts:

```bash
npm run typecheck   # type-check main/preload/renderer
npm run build        # production build into out/
npm test             # unit tests for the pure logic (ini parsing, RCON parsing, backup rotation)
```

## Setting up a server profile

From the dashboard, click **+ Add server**, then open it and fill in the **Settings**
tab:

- **Install directory**: the folder containing `ShooterGame/Binaries/...` for that
  server instance.
- **Map**, **ports** (game/query/RCON), and **RCON/admin password** — RCON must be
  reachable on `127.0.0.1` for this app to control the server (start/stop rely on it to
  save the world before shutting down).
- **SavedArks path**: relative to the install directory, defaults to
  `ShooterGame/Saved/SavedArks`.
- **Backup directory** and **max backups to keep**.

## Notes / limitations

- Tested with `npm run typecheck`, `npm run build`, and `npm test` in this environment,
  which has no display and no real ARK:SA install — so the actual Electron window and
  real start/stop/RCON/backup behavior against a live server have **not** been visually
  verified. Please run `npm run dev` on your machine, point a profile at a real
  install, and try Start/Stop/RCON/Backup end-to-end.
- The exact ARK launch command-line flags can change between game updates
  (`src/main/lib/serverProcess.ts`, `buildLaunchArgs`); use the profile's "Extra launch
  arguments" field if your install needs something different.
- Out of scope for this version: installing/updating the server via SteamCMD, remote/SSH
  or Docker-based control, and multi-user/remote web access (this is a single-user local
  desktop app).
