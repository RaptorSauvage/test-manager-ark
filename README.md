# Bober Server Manager

A small desktop app (Electron + React + TypeScript) for controlling ARK: Survival Ascended
dedicated servers running on the same machine.

## Features

- **Start / stop / restart / kill** one or more server profiles (each profile is an
  independent ARK:SA server install/instance). Stop and restart send RCON `SaveWorld`,
  wait for its confirmation, then wait another 30s for the save to actually finish being
  written to disk (RCON confirming the command only means ARK accepted it, not that every
  file is done being flushed - sending `DoExit` too soon risks the server exiting
  mid-write and corrupting the save it just claimed to have finished) before finally
  sending `DoExit`; Kill force-terminates the process immediately with no save, for when a
  server is stuck. Each server's card colors these buttons the same way the web dashboard
  does - Start green, Stop red, Restart orange, Update light blue (`--status-updating`,
  the same color the Updating status badge already uses) - plus Kill in its own darker red
  (`--danger-dark`), distinct from Stop's red so the more destructive action doesn't blend
  in with the merely disruptive one; Update sits right before Kill in the button row. The
  status badge tracks the OS process
  (`starting`), the server actually finishing loading - detected by polling its own log
  file (`ShooterGame/Saved/Logs/ShooterGame.log`) for the
  `Server has completed startup and is now advertising for join` line, since ARK's
  dedicated server allocates its own console on Windows instead of writing through the
  standard stdout handle a piped process would normally use - (`running`), and a distinct
  `restarting` phase for the shutdown half of a restart, so it never claims "running"
  before the world has actually loaded or while it's mid-restart.
- **Tolerates a process hand-off without a false "stopped"** — on some ARK builds, the
  dedicated server's OS process exits shortly after finishing startup while the game
  itself keeps running under a different, untracked process; Node correctly reports that
  as "the process we spawned exited", but that's no longer proof the server itself
  stopped. Any exit that wasn't asked for (i.e. not already mid `stopping`/`restarting`) -
  and the same for a monitored pid that `pidusage` can no longer find - is first double
  checked with a few spaced-out RCON round-trips before being believed. If RCON still
  answers, the Manager asks Windows (`netstat -ano`) which pid now owns the server's own
  RCON port - matched by the listening socket's placeholder foreign address
  (`0.0.0.0:0`/`[::]:0`) rather than the State column's text, since that text is localized
  (e.g. `LISTENING` becomes `ÉCOUTE` on a French install) while the address never is -
  and re-attaches full monitoring (CPU/RAM, force-kill) to it, so the switch is invisible in
  the UI. Only if that lookup can't find a match does it fall back to an RCON-only degraded
  mode; even then, the player list keeps refreshing every tick (CPU/RAM hold their last
  known values, since there's no trustworthy pid left to read them from). Only once RCON
  stops answering too does it actually finalize as `stopped`. A deliberate Stop/Restart/Kill
  is unaffected - it already flips the status before touching the process, so seeing it
  exit right after is never treated as unexpected.
- **Survives the Manager closing or crashing** — the server process is spawned detached
  from the app, so it keeps running either way instead of being torn down with it (the
  default on Windows otherwise). Relaunching the Manager re-detects any server that's
  still running (by pid) and picks it back up under management rather than losing track
  of it or letting you start a conflicting second instance.
- **No in-app console/RCON tab** — that live event feed + RCON command box lives only in
  the **web dashboard** (see below), not duplicated in the desktop app's per-server tabs.
  Stop/Restart still use RCON internally (`SaveWorld` before `DoExit`), and the RCON/admin
  password still isn't a field anywhere in this app - it's read live from the server's own
  `GameUserSettings.ini` (`ServerAdminPassword`) every time it's needed, since ARK:SA
  doesn't have a separate concept of an "RCON password". Reading that file strips a
  leading UTF-8 BOM first if present - a BOM (common after the file's been saved/re-saved
  by Notepad or some server panels on Windows) otherwise breaks the ini parser's section
  handling, silently making `ServerAdminPassword` unreadable even though it's right there
  in the file.
- **Mod manager** — a table (Enable/Passive/Dev checkboxes, Mod Name, Mod ID, plus
  reorder/remove) instead of a plain list. Reordering has a one-step ↑/↓ pair plus a ⤒
  button that jumps a mod straight to the top of the list, for a long list where nudging
  one row at a time would take forever. Enable/disable/reorder mod IDs and toggle a Dev
  flag per mod (appends `-dev` to load that mod's in-development build); enabled mods are
  applied via the server's `-mods=` launch flag by default, or `-passivemods=` instead if
  Passive is checked for that mod (ARK:SA's only mod mechanisms - no Steam Workshop, no
  GameUserSettings.ini involvement). Each header checkbox toggles that column for every
  mod at once. Mod Name is a free-text label you type in yourself, not looked up
  automatically. The app never touches your `.ini` files — edit those yourself.
  A **Copy / Paste Mod List** section below the table shares the whole list (ids, names,
  enabled/passive/dev flags, and order) as plain JSON text - **Copy mod list to clipboard**
  puts it on the clipboard directly (no save-file dialog), and pasting a previously copied
  list into the text box below and clicking **Import pasted list** replaces the table in
  the editor with it, then auto-saves like any other edit here (see below). Handy for
  sharing a modpack setup between servers without leaving a file on disk to clean up
  afterward.
- **Backups tab** — backup directory (folder picker or typed by hand, both save
  immediately - see below), max backups to keep, and scheduled
  automatic backups (gated behind an explicit enable/disable toggle, not just an
  empty/filled cron field) live here, instead of being split off into Settings. The
  scheduled task itself only actually runs while the server is online - not just skipped
  at fire time, but off entirely while the server is stopped: enabling the schedule (or
  saving the profile with it already on) only arms it if the server happens to be running
  at that moment, and it's armed/disarmed live from then on as the server actually
  starts/stops, not just at save time - so it never sits ticking away in the background,
  or shows as **Started** in the Analytics tab's Backup task status, for a server that's
  offline. This also means a scheduled tick can only ever fire while the server is
  running, but the fire-time "skip if not running" check (logged to the Backup Process Log
  below like any other cancellation) stays in place as a defensive fallback for the
  narrow race of the server stopping in the instant between the schedule arming and that
  exact tick firing. **Create backup now** is different: it's a deliberate one-off click, so it
  works whether the server is running or stopped. While it's running, a backup (manual or
  scheduled) requires a confirmed save first: it sends `SaveGame` (RCON `SaveWorld`) and
  cancels outright - no zip created - if that command doesn't confirm, rather than backing
  up a possibly-stale or mid-write state. Once confirmed, it waits 40s before actually
  reading the save files - RCON confirming the command only means ARK accepted it, not
  that every file under `SavedArks` has finished being written, and zipping too soon risks
  reading a file mid-write, which can crash the server (a locked, still-open file) as well
  as produce a corrupt backup. While the server is stopped, none of that applies - nothing
  is writing to those files, so **Create backup now** zips them as-is immediately,
  skipping SaveGame and the wait entirely. After that (or immediately, when stopped),
  every file directly under `SavedArks/<Map>` is added to
  the zip one by one, skipping `.arkrbf` rollback files and ARK's own periodic native
  backups (named like `Extinction_WP_29.07.2026_20.00.01.ark` - a timestamp suffix the
  main save file itself never has, so `<Map>.ark` is always kept regardless) since this
  app's own backups already cover that. Compression uses a moderate level (not maximum)
  - large save files barely compress any smaller at max effort, but cost much more CPU
  getting there, and that CPU spike was making the whole Manager appear
  frozen ("Not Responding") while a big backup zipped. The backup file
  list is a checkbox-select table (File Name/Creation
  Time, with a header checkbox to select/deselect all) with a toolbar above it - Refresh
  backup file list, Open backup folder (opens the configured backup directory in the OS
  file explorer), Restore selected backup, Delete selected backup(s) - instead of a
  Restore/Delete button pair per row. Multiple backups can be checked at once to delete
  them together; Restore only enables when exactly one is checked, since restoring more
  than one at a time isn't meaningful. Restore also requires the server to be stopped
  first (same rule as Profile Copy/Move) - extracting a backup straight into a live
  `SavedArks` overwrites save files the server may have open or be mid-write to, which
  only surfaces as a crash on the next restart rather than an error at restore time. The
  list also reloads itself automatically - both
  when a scheduled/cron backup completes in the background (the main process pushes a
  `backup:created` event for the tab to pick up, so you don't have to click Refresh to see
  it) and right after saving a changed backup directory in this tab, so switching folders
  immediately shows that folder's contents instead of the previous one's. A **Backup
  Process Log** panel alongside it traces every backup's SaveGame → 40s settle → zip
  sequence as it happens - both what's sent/confirmed and any cancellation/error - live,
  so a scheduled backup nobody's watching happen isn't a black box; kept in memory only
  (cleared on Manager restart), last 200 entries per profile.
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
- **Monitoring** — CPU/RAM usage and connected player count while a server is running. On
  Windows this reads through `src/main/lib/processStats.ts`, not
  [`pidusage`](https://www.npmjs.com/package/pidusage) - both of pidusage's own Windows
  backends proved unreliable in practice: its `wmic` path breaks outright on the growing
  number of Windows installs that have removed `wmic.exe` by default (and its `4.x`
  PowerShell fallback for exactly that case doesn't reliably trigger in this app's
  Electron/Node environment - a missing `wmic.exe` still surfaces as a raw `ENOENT`), and
  its PowerShell fallback itself invokes `powershell.exe` without `-NoProfile`, so on a
  machine where the user's own PowerShell profile script can't load (script execution
  disabled by policy, observed in practice) every reading fails with a PSSecurityException
  before the actual query ever runs. `processStats.ts` shells out to PowerShell's
  `Get-Process` directly instead, with `-NoProfile -ExecutionPolicy Bypass` (scoped to that
  one process, not a system-wide policy change) and explicit invariant-culture number
  parsing (a plain `.ToString()` would print a comma decimal separator on a
  French/European-locale Windows install). If a CPU/RAM reading still fails for any other
  reason, the Analytics tab's Server Status block shows "Unavailable" (hover, or the error
  line right below the grid, for the raw OS error) instead of just a bare `-`, so a
  persistent failure is diagnosable from the UI alone rather than needing the Manager's own
  console output.
- **Dashboard** — server cards can be dragged (via the ⠿ handle) into any order you like;
  the order is persisted and stays the same next time you open the app. A **Hide**/**Unhide**
  button on each card removes it from the main grid and the "...All" bulk actions without
  deleting it or touching whatever server process is actually running underneath - just a
  way to declutter the dashboard for a profile you're not actively using right now. Hidden
  profiles collapse into a "Hidden servers (N)" section at the bottom (collapsed by
  default) where they're still fully functional - Start/Stop/RCON/etc. all still work
  there - so unhiding one is a single click away. Separately, a **Dashboard group** field
  in each server's Settings ("Extra Settings" section) collects every profile sharing the
  same group name into its own collapsible section (expanded by default) instead of the
  main grid - handy for a cluster or a set of related test servers. A profile can be
  hidden and grouped independently; hidden always wins (it goes to the Hidden section
  regardless of its group). Each card also shows a **Version** field (the same Game
  Version as the Analytics tab, e.g. "92.28") - reads whatever's already known when the
  dashboard loads and shows "-" if nothing's been detected yet for that server (it doesn't
  actively poll/"Detect" here the way the Analytics tab does). The Map/Port/Version/
  Players/CPU/RAM fields sit in their own slightly darker inset panel within the card
  (rather than blending into the card's own background). The card is wide enough (380px
  max, up from the original 340px) that Start/Stop/Restart/Update/Kill all fit on one row
  instead of Update wrapping onto its own line - that row's buttons use tighter padding/
  font-size than buttons elsewhere so the row still fits at that width - with Manage/Hide/
  Delete on a second row below.
- **No native File/Edit/View/Window/Help menu bar** — this app never intentionally set one
  up; `Menu.setApplicationMenu(null)` (`src/main/index.ts`) removes Electron's unused
  default instead of leaving it to show up unasked for.
- **Sidebar / Cluster Dashboard page** — a left sidebar (`src/renderer/src/App.tsx`) with
  three entries, **Dashboard** (the page described above), **Cluster Dashboard**, and **Log**
  (see "Manager Log" below), shown whenever you're not inside a server's own tabs or one of
  the settings screens. Cluster Dashboard shows
  one row per **Dashboard group** (same grouping/ordering as the Dashboard's collapsible
  sections, hidden servers excluded, an "Ungrouped" row for anything with no group) with
  that group's servers summed together: how many are running out of the group's total,
  combined CPU %, combined memory (MB), and combined connected players out of the group's
  combined configured max. A stopped server contributes nothing to the numeric totals (its
  telemetry is stale/absent) but still counts toward the server total, so the totals always
  reflect what's actually running right now rather than what's configured. This reads the
  Manager's own dashboard `group` field - unrelated to ARK's own multiplayer clustering
  (`clusterId`/`clusterEnabled` in a profile's Settings), which is a completely separate,
  game-level feature. Each row also gets a **Server Statistics** chart identical in
  behavior to the per-server Analytics tab's (same sparklines, same hover tooltip, same
  gap-breaking) fed that group's *persisted* history summed across its servers -
  `src/main/lib/statsHistory.ts`'s `readClusterStatsHistory`, the same query the web
  dashboard's own Cluster Dashboard chart uses - rather than the group's own separate
  client-side sampling; only servers with stats enabled (Analytics tab) contribute to a
  group's chart, and a group with none of its servers opted in simply shows no chart. When
  some but not all of a group's currently-running servers have it on, a note above the chart
  spells out how many of the running servers it actually reflects - otherwise the chart (and
  the bold current-value numbers above each of its sparklines, which are simply that
  history's own last point) reading noticeably lower than the live CPU/Memory/Players totals
  in the row's own header looks like a bug rather than the servers that just aren't opted in. A
  single **Time Scale** selector at the top of the page (**1m/5m/15m/1h/6h/12h/24h/All**, same
  options and same main-process downsampling as the per-server chart) applies to every
  group's chart at once and re-queries every group when changed. A group with no history
  in the selected window (nothing enabled, or a fully-stopped group with nothing recorded
  recently) shows no chart at all rather than a flat line of zeroes. Every group is queried
  in a single IPC round trip (`statsHistory.getForGroups`) that reads and parses the shared
  stats-history file exactly once no matter how many groups exist, rather than once per
  group - that file can grow up to `AppSettings.statsHistoryMaxSizeMB` (1GB by default), and
  re-parsing all of it from scratch for every single group on every 5-second poll multiplied
  that cost by the group count for no reason. The parsed result is also cached in memory
  (`src/main/lib/statsHistory.ts`) and kept in sync incrementally as new samples are
  recorded, rather than re-reading the file from disk on every poll while any stats view
  stays open - that read is synchronous and runs on the same thread as every other Electron
  main-process job (IPC, window events, all of it), so repeating it every 5 seconds for a
  large file stalled the whole app noticeably each time, not just the chart. Only the very
  first read after the Manager starts still pays that one-time cost; every poll after that is
  an in-memory slice. Finding the earliest recorded sample for the
  **All** scale (`sinceMs === null`) is a plain loop rather than
  `Math.min(...samples.map(...))` - spreading every element as its own function argument
  throws "Maximum call stack size exceeded" once there are roughly 65k-130k of them
  (engine-dependent), and a single profile with stats enabled reaches six figures of recorded
  samples within days at one sample per ~5s. That crash was silent (an unhandled rejection in
  the renderer), so **All** could fail on every single poll indefinitely - only querying a
  narrower time scale (a concrete `sinceMs`, which skips that code path entirely) would ever
  get a chart to appear at all once a group's history grew large enough to trigger it. Each
  group's own combine pass (`readClusterStatsHistory`) drops its newest time bucket whenever
  it has contributions from fewer servers than the
  bucket right before it - each server's own stats-recording tick fires on an independent
  timer, so the very latest bucket can otherwise be read before every currently-running
  server has landed a sample in it yet, understating the combined total and showing a
  misleading dip right at the chart's leading edge (and in the bold current-value number
  above each sparkline, which is simply that history's own last point) until the next poll
  catches it up. A settled bucket further back is never dropped this way, so a genuine drop
  (a server actually stopping) still shows up normally.

  Clicking anywhere on a row other than its chart opens that group's **Group Console**,
  filling the full page: a live log feed merging every server in the group into one
  chronological view, each line tagged with a turquoise `[Server Name]` prefix - same
  visual language (checkboxes to show/hide event categories:
  JOIN/LEFT/CHAT/WARN/KILL/TAME/CMD/SAVE/CRYO/MISSION/READY, colored labels) as the
  standalone web dashboard's own console, but merging every server in the group instead of
  showing just one, plus three categories the web dashboard doesn't have: **START**,
  **STOP**, and **UPDATE**, synthetic lines this page injects itself (not parsed from the
  log - there's no log line for "the Manager noticed this server is now
  running/stopped/updated") whenever a server's live status actually transitions, colored
  green/red/blue - the line has no visible label tag (unlike every other category), it's
  just the colored "&lt;name&gt; started"/"&lt;name&gt; stopped"/"&lt;name&gt; updated" text,
  though the label still exists under the hood for the Show filter checkboxes above. A
  server going 'updating' -> 'stopped' (a plain Update that wasn't paired with a restart)
  logs as UPDATE rather than STOP - without that distinction it would misleadingly look like
  the server stopped twice in a row (once for the STOP that may have preceded the update,
  once more when the update itself finished). Its filter checkboxes are independent of the web dashboard's own
  persisted per-label setting (toggling one here doesn't affect the other) and, unlike that
  setting, persist across sessions on their own. An **Auto-scroll** checkbox sits alongside
  the Show filters (unchecked by default) - only when checked does a new event jump the feed
  to the bottom; otherwise it appends silently wherever you've scrolled to. Either way,
  opening the console always jumps to the latest entry in the backlog first - Auto-scroll
  only decides what happens once new events start arriving live. Events are merged by their actual log date
  plus time, not time-of-day alone - a single server's backlog can itself span more than a
  day, so HH:MM:SS by itself isn't enough to correctly order events from multiple servers'
  backlogs together. Only servers that are actually running get their new events tailed
  live - the main process starts/stops each server's own tailer in real time as it starts
  or stops while the console page is open (`src/main/lib/groupConsole.ts`, one
  `watchLogFile` per running server in the group, the same primitive every other
  log-following feature in this app already uses concurrently); a stopped server's older
  history still shows up in the initial backlog, it just stops growing. Navigating back
  stops every tailer still active for that group. That initial backlog survives a server
  restart too, not just a stop: independently of the console page being open at all,
  `src/main/lib/clusterLogArchive.ts` continuously parses every running server's log growth
  (for as long as it's running, wired off the same status events as everything else) the same
  way the live tailer above already does, and appends only the resulting displayable events
  (one per line, as JSON) to a permanent per-server archive file under the Manager's data
  folder, separate from ARK's own `ShooterGame.log` (which a server restart truncates back to
  empty for the new session). Everything `parseLogLine` itself treats as internal engine
  noise for display purposes - the bulk of the raw file - never reaches the archive either;
  there's no reason to spend archive space (or read time later) on a line nothing would ever
  show. The backlog above reads from that archive instead of the live log whenever one
  exists, so it can show history from before the server's last restart - the live log is only
  a fallback for a profile that's never been archived yet (a fresh install, or one that
  simply hasn't started since this existed). The archive is a rolling window rather than
  growing forever: each server has its own **Max archive size (MB)** setting (Server
  Management tab, 1-100, default 10) past which the oldest events are trimmed automatically,
  always on with no separate enable toggle - this is passive background logging, not an
  automated action. The same **START**/**STOP**/**UPDATE** events the live Group Console
  injects for itself (see below) are also archived directly by the main process the moment
  they happen - `handleStatusForClusterLogArchiveNotification`, wired off the same status
  events as the tailer above, with its own copy of the same 'updating' -> 'stopped'
  exception (an update finishing without a restart archives as UPDATE, not a second STOP) -
  so a Start/Stop/Restart/Update shows up in a *future* backlog even if no console was open
  to see it live and even across a Manager restart, independent of the renderer's
  own copy of this logic.

  Each log line also shows its date as
  **DD/MM** next to the HH:MM:SS timestamp (derived from ARK's own "YYYY.MM.DD" log date,
  the same field the merge/sort already relies on), since a merged multi-server feed can
  span more than one day. Below the log feed sits an **RCON command bar**: a target
  selector listing every server in the group plus an **ALL** option, a text field for the
  command, and a Send button - sending to ALL fans the same command out to every server in
  the group at once (one `sendRconCommand` call per server, same non-throwing
  `{ ok, response/error }` result as everywhere else RCON is used in this app) and shows
  each server's individual result above the bar.

  A vertical divider separates the log/RCON column from a right-hand **sidebar**. At the
  top of the sidebar, a cluster summary shows how many of the group's servers are online
  (with the offline count in parentheses), total connected players, and total CPU%/RAM
  summed across whichever servers are currently running - the same aggregation the Cluster
  Dashboard row above already computes for its chart. Below that, one card per server shows
  its live status badge, Game Version, connected/max players, and CPU%/RAM - the same fields
  and `badge badge-<state>` styling as the Dashboard's own server cards, fed by the same
  `useServerStatuses` live-status hook. Clicking a card opens that server's own profile (same
  place the Dashboard's "Manage" button goes); right-clicking it instead opens a small
  context menu with **Start**, **Stop**, **Restart**, **Update** and **Update Restart** -
  colored the same as the Dashboard's "All" bulk-action buttons (green/red/amber/blue),
  except Update Restart which gets its own cyan to stand out from the plain Update.
  Update is the plain SteamCMD install/update (only while stopped, like the Dashboard's own
  per-server Update button). Update Restart mirrors the Dashboard's "Stop+Update+Restart":
  it stops the server first if it's running, runs the SteamCMD update, then starts it back
  up if it was running before. Whenever a server in the group actually transitions to
  running or stopped (not for the in-between starting/stopping/updating/restarting states),
  the matching START/STOP/UPDATE line described above lands in the log feed - no separate
  toast popup, just that permanent feed entry. Each profile's last-seen status is tracked at
  module scope rather than tied to this page being mounted, so starting or stopping a
  server from the Dashboard while the Group Console isn't open still produces that log line
  the next time you open the console for that group - only each profile's very first status
  observed this session is treated as a baseline, not a transition.
- **Analytics tab** — the first tab on every server, read-only:
  - **Server Status**: one consolidated group with everything at a glance, no explanatory
    text and no sub-headers - just the fields:
    - PID, connected players (X / configured max), CPU usage (%), and Server Memory (MB
      and % of total system RAM) - laid out PID/Players then CPU/Memory so the two live
      resource readings sit next to each other. Uptime (live, ticking every second while
      running) sits further down, next to Next backup in. Uptime survives a Manager
      restart too - the actual start time is persisted alongside the pid it already
      tracks to re-adopt a still-running server, so a re-adopted server shows real
      elapsed uptime instead of losing it.
    - **Game Version**, with the **Installed Build ID** shown in parentheses right next to
      it (e.g. `92.43 (24786897)`). These are two separate numbers under the hood, since
      ARK exposes them differently: Game Version (e.g. "92.28") is the human-readable
      version ARK itself prints, read straight from the "ARK Version: 92.28" line it
      writes to `ShooterGame.log` near the start of boot. (An earlier version of this
      feature tried to read it back from the server's own console window title via
      PowerShell/Win32 APIs instead - that turned out to be unreliable for a server
      adopted after a Manager restart; reading the log line directly sidesteps that.)
      Refreshed by `serverVersionWatcher.ts`, edge-triggered on the server's status
      transitioning into `running`/`starting`/`stopping`/`updating`/`stopped`, plus once
      for every profile when the Manager itself starts. Installed Build ID is the
      SteamCMD-installed build id, read straight from that install's
      `appmanifest_2430930.acf` - blank before the first install. Game Version keeps
      showing the last value read even while the server is stopped (it doesn't change
      between runs, so there's no reason to blank it out) - "Detecting..." only appears
      while running and nothing's been read yet, "Unknown" if it's never been read at all.
    - **Backup task status** always shows one of four states: **Offline** (light red)
      whenever the server itself isn't running, regardless of the schedule - the backup
      task's own "active" flag is about whether its timer is armed, which is unrelated to
      whether the ARK process is currently up, so this avoids implying a backup could fire
      right now when it can't; **Deactivate** (red) when the server is running but the
      backup schedule is disabled in the Backups tab; otherwise **Started**/**Stopped**
      read directly off the same timer that will actually fire the next backup (a single
      self-armed `setTimeout` recomputed via `cron-parser` after every run, rather than a
      background library polling every second). **Next backup in** (a live countdown) only
      appears alongside a genuine Started/Stopped reading.
    - The update-check status line ("No new update available." / "A server update is
      available.") - compares this profile's installed build id against the latest one
      Steam has published, polled every 30 minutes straight from SteamCMD (anonymous
      login, `+app_info_print 2430930`, no download involved). SteamCMD needs to be
      configured in Settings for this to resolve to anything.

    To the right of these fields, separated by a vertical divider, a **File Shortcuts**
    column stacks three buttons vertically, no explanatory text: **INI Config**
    (`ShooterGame/Saved/Config/WindowsServer`, where `GameUserSettings.ini`/`Game.ini`
    live), **Save ARKs** (`ShooterGame/Saved/SavedArks`, the map save data), and
    **Save Game** (`ShooterGame/Saved/SaveGames`, mod-specific persistent data) - all just
    open the OS file explorer at that path, the app never edits anything in them itself.

  - **Config file lock**: `GameUserSettings.ini`/`Game.ini` are set read-only 5 seconds
    after a server starts, and set back to writable 5 seconds after it fully stops
    (`src/main/lib/iniLock.ts`, driven off the same status events described above - the 5s
    margin on both ends gives the ARK process, and the OS's own file handle cleanup, a
    moment of slack around the transition instead of racing it). This is an OS-level
    read-only attribute toggle (`fs.chmod`), so it's respected by Notepad and most editors
    that overwrite a file in place, but not by editors that save via a temp-file-then-rename
    (e.g. VS Code) - it's a deterrent against editing a running server's config by accident,
    not a hard guarantee. Nothing in this app ever writes these files itself, so the lock
    can never block a legitimate in-app write. A quick restart just re-locks the files once
    it's running again rather than briefly unlocking them mid-restart. If the Manager
    crashes or is force-quit while a server was running (and its config was locked), every
    non-running profile's config gets unlocked once at the next Manager startup as a safety
    net, so a crash can't leave the files stuck read-only. Controlled by **Lock config files
    while a server is running** in the app-wide Settings view (on by default) - turning it
    off immediately unlocks every profile's config files, including ones currently running,
    and locking stays off until it's turned back on.
  - **Server Statistics**: three sparkline charts (CPU %, RAM in MB, connected players),
    stacked with no gap between them and the metric name on the left of each row rather
    than above it. An **Enable stats** checkbox (`ServerProfile.statsEnabled`, off by
    default) turns on continuous background sampling for this server: every 5s while it's
    running, `src/main/lib/monitor.ts` records a CPU/RAM/player sample straight to a
    persistent, global history file (`src/main/lib/statsHistory.ts`), independent of
    whether this tab - or the Manager itself - is even open. That's a real behavior change
    from a per-browser-tab feature: history now survives closing the tab, switching
    profiles, and restarting the Manager, and every server sharing this toggle draws from
    one combined disk budget (**Stats history size limit (MB)** and **Stats history
    retention (hours)** in the app-wide Settings view, defaults 1024/1GB and 24h - see
    below) rather than each keeping its own separate quota.
    A **Time Scale** selector (**1m/5m/15m/1h/6h/12h/24h/All**) picks how far back to query -
    "All" means every sample ever recorded for this server, no lower bound. Whichever scale
    is picked, the Analytics tab asks the main process for at most 500 points spanning that
    window; a query covering more raw samples than that gets bucketed and averaged down to
    500 on the main-process side before it's ever sent to the renderer, so switching to
    "All" over weeks of history is never slow to fetch or render just because there's a lot
    of it. The chosen scale is still remembered per server in local storage, so it stays on
    whatever you last picked instead of resetting to the 12h default the next time you open
    the tab. Hovering a row shows a vertical guide line plus a small tooltip with the clock
    time and value of the nearest point. The CPU row's scale adapts to the highest value
    actually seen in the current window (with a small floor so a near-idle server's jitter
    doesn't get blown up to fill the whole row) rather than always spanning a fixed 0-100%
    range, so a server that never spikes past e.g. 40% still uses the chart's full height
    instead of hugging the bottom - RAM already worked this way. Not capped at 100%: CPU
    usage is measured per-process across all cores, so a multi-threaded server can
    legitimately read well above 100%, and every row's points are clamped to stay within
    the chart's own height regardless of scale, so nothing ever draws outside its row. The
    Players row scales the same way, to the highest player count actually seen in the
    window - never to the server's configured max slot count, which against a 70-slot cap
    made 0 vs 1 connected player an invisible 1/70th blip regardless of how full the chart
    otherwise looked. A
    gap large enough to represent several missing points in a row (server stopped for a
    while, stats disabled and re-enabled, ...) - scaled to how far apart points actually are
    at the current resolution, not a fixed threshold, since "All" over weeks and "6h" sample
    at very different granularities - breaks the line into a separate segment instead of
    connecting them with a straight slope, so the chart never draws a misleading diagonal
    bridging two readings that aren't actually part of the same continuous run. Each point
    is placed by its real timestamp within the selected window rather than spaced evenly by
    index, so a window that isn't fully populated yet only draws a line across the portion
    of the chart that has real data instead of stretching a handful of samples across the
    whole width. Deliberately hand-rolled inline SVGs, not a full-page chart library, to
    keep this "a small graph" rather than the whole page. The tab itself just polls its
    query every 5s while open and renders whatever comes back - all the actual sampling
    keeps running in the main process regardless of which tab (if any) is open.
- **Open profiles folder** — a button in the app-wide Settings view opens the folder
  holding this app's own data file (profiles, app settings, which pid belongs to which
  running server): a single `config.json`, written by `electron-store` at Electron's
  standard per-OS user-data location. It's already plain JSON, just one shared file for
  everything rather than one file per profile like an exported profile.
- **Start Manager when you log into Windows** — a checkbox in the app-wide Settings view,
  backed by Electron's own `app.setLoginItemSettings`. Applied both right away when you
  save Settings and again at every app launch, so it stays in sync even if the OS-level
  registration was changed outside the app. Opens the normal window on login (no
  minimized/background mode yet).
- **Delay between auto-started servers** — a number input (seconds, default 10) in the
  app-wide Settings view. Only matters for profiles with "Start this server when the
  Manager starts" enabled (Server Management tab): the delay is waited before starting the
  first such profile too (not just between subsequent ones), giving the Manager's own
  monitoring time to finish initializing first so that server's telemetry is picked up
  correctly from the start instead of racing a start triggered the instant the app launches.
  Each subsequent enabled profile then waits this same delay after the previous one.
- **Manager updates** — a "Check for updates" button in the app-wide Settings view, next
  to the current version. Built on `electron-updater` against this repo's GitHub
  Releases, with live status (checking / downloading with a percentage / up to date /
  error) pushed to the button's status line as it progresses. Checking and downloading
  are automatic, but installing is a deliberate second step: once a download finishes, a
  separate **Restart & install now** button appears - the app never quits and restarts on
  its own, so it can't cut off unsaved changes elsewhere in the app (e.g. a SteamCMD path
  typed but not yet saved) mid-edit. Only works in an installed build (the NSIS installer
  or the portable exe, both produced by `npm run dist`), not when running from source
  with `npm run dev`, since there's no update feed to read from in that case. See
  [Publishing a release](#publishing-a-release) for how a new version actually reaches
  this button.
- **Profile Management** — a dashboard header button opens a dedicated view to **Copy**
  or **Move** an entire server install (every file under its install folder - binaries,
  saves, configs, all of it) to a different folder:
  - **Copy** duplicates it as a brand new, independent profile (fresh id) - the original
    is left untouched.
  - **Move** relocates (and optionally renames) the same profile in place - nothing is
    duplicated.
  Both require the server to be stopped first, reject a destination that already has
  files in it, and reject picking the current install folder as the destination. A move
  tries a plain rename first and only falls back to a real copy-then-delete if that fails
  across drives/filesystems (`EXDEV`). No app restart is needed either way - saving the
  resulting profile goes through the same path as any other Settings change, so its
  backup schedule/watchers etc. get reapplied against the new location automatically.
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
  `logs/steamcmd-update-<profileId>.log` inside the "Data files location", see Settings
  below), so an update failure is
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
  that's treated as success regardless. If the configured SteamCMD path no longer points
  at an actual executable (e.g. a packaged build's managed SteamCMD copy got wiped by
  reinstalling/updating the Manager itself), Update fails immediately with a clear
  "SteamCMD not found at ..." message instead of a raw `ENOENT` - reinstall or re-point
  SteamCMD via the SteamCMD menu to fix it.
- **Add firewall rule for SteamCMD** (SteamCMD menu, Windows only) — adds Windows Firewall
  allow rules (inbound + outbound) for whichever `steamcmd.exe` is configured above, useful
  if update failures turn out to be network-related. Prompts once for admin rights (UAC)
  just for that action - the app itself keeps running unelevated the rest of the time.
- **Global Performance** (dashboard sidebar, above Official Server Status) — a compact stats card
  showing totals across every visible (non-hidden) server: **Servers running** (with the
  total server count alongside it), **Players**, **CPU**, and **RAM** - the same
  `useServerStatuses` live-status data every server card already renders, just summed
  client-side rather than a new backend aggregation. Reuses the Group Console's own
  `.group-console-cluster-stats` grid styling, so it reads as the same kind of summary box
  rather than a bespoke widget. Updates live as server statuses change, same as everything
  else fed by that hook.
- **Official Server Status** (dashboard sidebar) — fetches Wildcard's official ARK:SA
  server status feed (`https://cdn2.arkdedicated.com/asa/officialserverstatus.ini`).
  Despite the `.ini` extension, the file isn't key/value INI - it's a single line like
  `ARK Official Server Network Status: <RichColor Color="0, 1, 0, 1">Online (v92.25)</>`,
  which is parsed with a dedicated regex into a label, status, version, and the
  `RichColor` (four 0-1 floats, Unreal Engine's usual color format) converted into a CSS
  `rgb()`/`rgba()` color, then shown as "Official Server Network Status : Online
  (92.25)" in that color. A Refresh button re-fetches on demand.
- **Settings** (dashboard) — laid out as a few labeled cards (Data & Storage, Startup &
  Safety, Web Dashboard, ...) that wrap across the window instead of one long column of
  unrelated fields, same treatment as the per-server Settings/Server Management tabs
  (`.app-settings-view` in `styles.css`). Lets you override the "Data files location"
  (default:
  Documents/ARK Server Manager), the folder `maps.json`, `customMaps.json`, the managed
  SteamCMD install, per-profile update logs, and any future editable/generated files live
  in. Changing it only affects where the app looks going forward - it doesn't move
  existing files to the new folder for you. A **Stats history size limit (MB)** field
  (default 1024 / 1GB) caps the combined size of every server's persisted CPU/RAM/player
  history (`src/main/lib/statsHistory.ts`, see Analytics tab below) - one shared budget
  across every server with stats collection enabled, not a per-server quota; the oldest
  samples, from whichever server they belong to, are trimmed first once it's exceeded.
  Alongside it, a **Stats history retention (hours)** field (`AppSettings.statsHistoryMaxAgeHours`,
  default 24) independently drops any sample older than that many hours regardless of how
  much of the size budget above is still free - this is what actually bounds how much a
  long-running Manager ever has to read and parse to answer a stats query, since the size
  cap alone still lets the file (and the in-memory cache mirroring it) grow arbitrarily
  large if nothing ever collects enough data to hit it. The check only runs at most once
  every 5 minutes (and only once something has actually been read into memory), so it
  doesn't rewrite the file on every single sample. Set it to 0 to disable age-based
  trimming and fall back to the size cap alone. The app-wide Settings screen itself is
  organized into four sub-tabs - **General** (Data & Storage, Startup & Safety), **Web
  Dashboard**, **Access Tokens** (both the access token and API key lists, described below),
  and **Updates** - rather than one long scrolling page, so a specific setting is a click
  away instead of a scroll. This is also where the **web dashboard** is
  enabled - the only place in this app for a live console feed and RCON, on purpose (the
  desktop app itself has no console/RCON tab). It's a plain HTTP server built into the
  Manager (no separate process), serving a page with a sidebar that starts with, in order,
  **Dashboard** (admin-tier tokens only - see roles below) and **Cluster Dashboard** - the
  latter is the main/landing view every page load opens on, with nothing else in the
  sidebar yet besides Dashboard. **Dashboard** replicates the desktop Manager's own
  Dashboard page as a card grid, grouped the same way (ungrouped servers first, then each
  Dashboard group as its own labeled section) - each card shows State/Version/Players/CPU/
  RAM and the same Start/Stop/Restart/Update/Update Restart action menu (the "⋮" button) as
  the mobile Group Console's own cards below, but no **Manage** button - clicking a card
  (outside that menu) selects that server and jumps straight to its Console, exactly like
  tapping a mobile Group Console card already does. It's built from the exact same
  `buildServerCardMobile` card renderer as that mobile view, just laid out as a responsive
  grid instead of one mobile column. A single separator, then one flat group of eight
  per-server tabs, in this order - **Console**, **Analytics**, **Settings**, **Mods**,
  **Backup**, **Map Management**, **Server Management**, **Update Log** - only appears in
  the sidebar once a server has actually been clicked (a card inside a group's mobile Group
  Console, the Dashboard tab above, or any of these eight tabs' own server picker, top-right
  of the header, once one of them is reachable some other way). Of those eight, **Settings**,
  **Mods**, **Map Management**, and **Update Log** additionally require the connecting
  token/key to be role `admin` or `globalAdmin` (or no login requirement at all, in which
  case every route is effectively `globalAdmin`) - see **Access tokens** further below for
  what each of the four roles can reach. **Server Management** requires `moderator`
  or higher (a narrower tier than the other four admin-only tabs) through its own dedicated
  `GET`/`POST /api/servers/:id/servermanagement` route - a whitelist of just the fields that
  tab edits, never the rest of the profile the admin-only `/profile` route exposes.
  **Console**, **Analytics**, and **Backup** stay available to any role, same as before. This
  is a deliberate gate, not just a first-load default: a plain `selectView('console')` call
  still works even while its nav button is hidden (so drilling in via a card always works),
  but nothing pre-selects a server on load the way earlier versions of this page did - every
  one of these views starts genuinely empty until you choose a server yourself. These eight
  tabs are only ever in the sidebar while you're actually looking at one of them - navigating
  back to **Dashboard** or **Cluster Dashboard** hides them again rather than leaving them
  parked in the sidebar for the rest of the page's session, so those two overview tabs stay
  focused on servers in general rather than whichever one you last drilled into. Clicking a
  card again (from either overview) reselects that server and reveals the eight tabs once
  more, landing on Console. Losing the currently-selected server out from under you (e.g.
  that profile gets deleted) falls back to Cluster Dashboard the same way, which also hides
  the tabs. Every one of the eight tabs carries an
  identical **server picker** dropdown at the top-right of its own header (`.server-picker` -
  `margin-left: auto` pushes it to the far right of the flex header row), listing every
  server by plain name only (no "(running)"/state suffix cluttering it up - that's what each
  tab's own content already shows), grouped into `<optgroup>`s by Dashboard group exactly
  like the Settings tab's own Map dropdown groups Official/Custom maps - ungrouped servers
  listed bare above the first optgroup, each group's servers in the same order the desktop
  dashboard shows them in. Switching it on any one of the eight instantly switches all the
  others to the same server too (`syncServerPickers`), so hopping from, say, Analytics
  straight to that same server's Mods tab, or over to a completely different server's
  Settings, never requires detouring back through Cluster Dashboard first:
  - **Cluster Dashboard** - a mobile-adapted version of the desktop Manager's own Cluster
    Dashboard page, not just a per-server card grid: one summary row per Dashboard group
    (ungrouped servers get their own "Ungrouped" row), same shape as the desktop version -
    how many of the group's servers are online (offline count in parens, green), combined
    players/max, combined CPU%, combined RAM - computed client-side from the same
    `/api/servers` poll the Console view already uses, no separate request. Hidden
    profiles never appear here, same as everywhere else in this page. On a screen at least
    701px wide (the same breakpoint the rest of this page's mobile layout switches on), each
    row with at least one server online also gets the same **Server Statistics** chart as
    the desktop Manager's own Cluster Dashboard - CPU/RAM/Players sparklines with a
    **Time Scale** selector (**1m/5m/15m/1h/6h/12h/24h/All**) above the cards and a hover tooltip on each
    chart, built from the same SVG-path math (`sparkline.ts`/`ServerStatsChart.tsx`)
    reimplemented in this page's own vanilla JS. Unlike the mobile layout's other data, the
    chart's history isn't sampled or accumulated in the browser at all - it's fetched from
    the same persistent, main-process stats store the desktop Manager itself records to
    (`GET /api/groups/:group/stats`, backed by `src/main/lib/statsHistory.ts`), once per
    group per poll (every 5s), server-downsampled to at most 500 points regardless of the
    selected scale. That means every viewer of this page, and the desktop Manager, all see
    the exact same recorded history - not a separate per-browser copy - and only servers
    with stats collection enabled (the Analytics tab's toggle) contribute to a group's chart.
    Only the selected time scale itself is remembered in this browser's `localStorage`. Each
    poll updates a row's numbers and chart in place (existing text/SVG elements, not a torn
    down and rebuilt card) - rebuilding the whole card list from scratch every 5s used to
    blank each card for the moment between that rebuild and the chart's own re-fetch
    resolving, a distracting flicker even though nothing had actually changed.
    Narrower than 701px, the chart and time-scale selector don't render at all, keeping the
    mobile layout to the plain numeric totals. Tapping a row (outside the chart, which has its own click
    handler so it doesn't also trigger this) drills into that group's own **mobile Group
    Console**, which mirrors the desktop Manager's Group Console feature-for-feature:
    - A merged, chronological log feed across every server in the group, each line tagged
      `[Server Name]` in the same turquoise as the desktop Group Console (with a space
      before whatever follows it - label or, for the label-less START/STOP lines described
      below, straight into the text), backed by two new endpoints -
      `GET /api/groups/:group/events` (the merged backlog, reusing
      `src/main/lib/groupConsole.ts`'s `getGroupConsoleBacklog`) and
      `GET /api/groups/:group/events/stream` (the live merged tail, reusing that same file's
      `watchGroupConsole` - one `watchLogFile` per running server in the group, exactly like
      the desktop Group Console's own IPC channel, just reached over HTTP/SSE instead).
      Ungrouped is addressed as the literal path segment `_ungrouped_` (an actual empty
      segment invites double-slash URL edge cases). Each line shows its date as **DD/MM**
      next to the timestamp, same as the desktop version, since a merged feed can span more
      than a day. On a phone, the feed's text drops to the same smaller size the
      single-server Console view's own console already uses below 700px, so more history
      fits without either view feeling inconsistent.
    - A "Show:" row of checkboxes (persisted in this device's `localStorage`, independent of
      the page's own admin-controlled per-label setting) includes three categories no real
      log line produces - **START**, **STOP**, and **UPDATE** - synthetic lines this page
      injects itself the moment a group member's live status actually transitions to
      running/stopped, colored green/red/blue, with no visible label tag (just the colored
      text) though the label still exists for the filter checkboxes. A plain Update finishing
      (no restart) goes 'updating' -> 'stopped' and logs as UPDATE rather than STOP, so it
      doesn't read as the server stopping twice in a row. A **Show ▾** button next to the group name
      collapses/expands the whole checkbox row - same collapse-to-`localStorage` pattern as
      the single-server Console view's own **Events ▾** toggle, independent key so
      collapsing one doesn't affect the other. That same row ends with an **Auto-scroll**
      checkbox (unchecked by default, persisted the same way) - only when checked does a new
      merged event jump the feed to the bottom; opening the group console always jumps to the
      latest backlog entry first regardless.
    - Whenever any server's status transitions to running or stopped - not just a member of
      the currently-open group, and not for the in-between
      starting/stopping/updating/restarting states - a toast pops (green "started" / red
      "stopped" / blue "updated"), and if that server belongs to the group whose console is
      currently open, the matching START/STOP/UPDATE line lands in its feed at the same
      moment. Each server's
      last-seen state is tracked for as long as the tab stays open (not tied to which view
      is active), so a transition that happens while you're looking at a different tab still
      gets caught the moment you look back.
    - A compact aggregate stats box below the header (online/offline, players, CPU, RAM -
      the same numbers as that group's row on the list above); smaller padding and text on a
      phone, where screen space is tighter, than on desktop.
    - The feed and RCON bar sit in the same `.panel.console-panel`/`.content-row`/`.side-col`
      layout the single-server Console view already uses: a wide console column that
      actually gets the room (flex-grown to fill the available height on desktop, a fixed
      generous fraction of the screen on mobile, same as that view), next to a **Servers ▾**
      column of one card per server (live status badge, Game Version, players/max, CPU/RAM)
      - collapsible on both desktop and mobile via the header button, same
      collapse-to-`localStorage` mechanism as the filters toggle and the single-server
      view's own **Status ▾** column toggle, so the console can have the whole width to
      itself when you don't need the per-server detail. On desktop this reproduces the
      Manager's own Group Console shape (console on the left, a divider, server info on the
      right); on mobile the column stacks below the console instead, same responsive
      behavior the single-server Console view already has for its own side column.
      Tapping a card opens that server's own Console view (same place the row's click used
      to go before this feature); tapping the **⋮** button on a card instead opens a small
      action sheet - **Start**, **Stop**, **Restart**, **Update**, and **Update Restart**,
      the same five actions, enabled/disabled rules, and color coding (green/red/amber/blue/
      cyan) as the desktop Manager's own Group Console context menu - reusing the exact
      same `/api/servers/:id/start|stop|restart|update|stop-update-restart` routes the
      single-server Console view's own buttons already call. There's no right-click on a
      phone, so a button is the mobile equivalent; the sheet is positioned from wherever
      that button is, clamped to stay within the screen so a card near the bottom edge never
      opens a menu that's partly or fully unreachable (`position: fixed` doesn't respond to
      page scroll, so an unclamped menu could otherwise land below the visible viewport with
      no way to reach it).
    - An RCON command bar below the feed, inside the same console column: a target dropdown
      (every server in the group, plus an **ALL** option) and a text field - sending to ALL
      fans the same command out to every server in the group at once (one
      `/api/servers/:id/rcon` call per server, same as the desktop version's fan-out), with
      each server's individual result shown above the bar.
  - **Console** - the per-server console/RCON view (what this page originally was, and what
    the sidebar button used to be labeled **Dashboard** - renamed since "Dashboard" already
    means the desktop app's own main page, and this view has nothing to do with that one).
    Still reachable directly once a server is selected, just no longer the tab this page
    opens on. Its Status box shows **State** as the same colored
    pill badge as the Group Console's own server cards instead of plain text, plus **Version** (the
    Game Version, e.g. "92.28") alongside Players/CPU/RAM - both boxes pull from the same
    `/api/servers` response, so they always agree. Its server picker (top-right of the
    header, listing profiles in the same order as the desktop dashboard and grouped into
    `<optgroup>`s the same way - ungrouped first in their reordered position, then each group
    alphabetically, leaving out anything marked **Hidden** - options show the plain server
    name only, no "(running)"/state suffix, since every tab that has one already shows state
    some other way) is the same shared `.server-picker` every one of the eight per-server
    tabs carries, not something unique to this view.
  - A live, color-coded event feed - only the event label is colored (plus the player's
    name specifically for JOIN/LEFT), not the whole line. It tails the server's
    `ShooterGame.log` file directly on every page load/reconnect (the same per-connection
    approach the standalone Python dashboard this replaces used), classifying each
    interesting line into JOIN/LEFT/CHAT/CMD (admin commands)/WARN (structure
    destroyed)/KILL/TAME/SAVE/CRYO (freeze)/MISSION/READY and filtering out the engine's
    internal noise - independent of whether the Manager's own process tracking currently
    considers that server running. A "Show:" row of checkboxes lets you hide individual
    categories from the feed; this is server-side and persisted, applied to the backlog
    and the live stream alike, so a disabled category is simply never sent to the
    browser. That row also ends with an **Auto-scroll** checkbox (client-side only,
    unchecked by default) - only when checked does a new event jump the feed to the
    bottom; selecting a server always jumps its console to the latest backlog entry first
    regardless. An **Events** button next to that row collapses/expands the whole checkbox
    row (handy on a small screen); the collapsed/expanded state is remembered in
    `localStorage`. Whenever the Manager (re)starts that server - Start, Restart, or the
    restart step of Stop+Update+Restart, from this page, the desktop app, or a bot calling
    the [API](#web-dashboard-api-for-bots--other-tools) - the feed clears and starts fresh
    for the new session instead of mixing its lines in with the previous one's, since the
    Manager knows the exact moment it spawns a new process for that profile. As a backup
    for a restart the Manager didn't itself trigger, the feed also clears when it notices
    `ShooterGame.log` itself has been replaced (its inode changed, not just its size, so a
    fast restart can't be missed).
  - An RCON command box right below the feed - commands sent and their responses appear
    as entries in that same feed, in order.
  - A small **Status** box in the right-hand column, above the online players panel -
    state, player count, CPU%, and RAM for the selected server, each on its own line
    instead of one long line squeezed into the header (that's what it used to be), followed
    by **Uptime** - live, ticking every second while the server is running, same "0d 2h 3m
    4s" format as the desktop Manager's own Analytics tab, computed from the `startedAt`
    timestamp now included in every `/api/servers` entry; shows "-" when the server isn't
    running. A **Status ▾** button in the header, next to the **Events ▾** filter toggle, collapses/
    expands that whole right-hand column (both boxes together), for more room for the
    console - handy on a small screen; remembered in `localStorage` like the Events
    collapse toggle.
  - An **online players** panel below that, refreshed every few seconds via RCON
    `ListPlayers`. Right-click a player for **Copy ID** (their EOS unique id, to the
    clipboard - falls back to a `document.execCommand`-based copy when the page isn't in
    a secure context, e.g. reached via a LAN IP over plain http, since `navigator.clipboard`
    isn't available there) or **Kick** (red, asks to confirm, then sends RCON
    `KickPlayer <id>`).
  - **Start / Stop / Restart / Stop+Update+Restart** buttons in the header, for the
    currently selected server - the same actions as the desktop app's own per-profile
    buttons and bulk "…All" actions, reusing the exact same underlying logic (both call
    into `src/main/lib/serverActions.ts`, so starting/stopping the CPU/RAM monitor stays
    in sync regardless of which UI triggered it). Buttons enable/disable based on the
    server's current state, same rules as the desktop app (Start only when stopped,
    Stop/Restart only when running, Stop+Update+Restart disabled mid-update). Stop and
    Restart wait only for SaveWorld's RCON outcome before responding (usually a couple of
    seconds) - a toast warns if that couldn't be confirmed - then the rest keeps running
    in the background; Stop+Update+Restart responds immediately once kicked off without
    waiting for any of it, since a SteamCMD update alone can take minutes. Either way the
    button doesn't hang; the Status box and player panel simply update on their next
    poll as the state actually changes (stopping → updating → starting → running). There's also
    a standalone update endpoint (`POST /api/servers/:id/update`, no button on the page
    itself - Stop+Update+Restart already covers the interactive case) meant for external
    automation, e.g. a Discord bot on the same machine calling into this same API - see
    [Web dashboard API](#web-dashboard-api-for-bots--other-tools) below.
  - The selected server is remembered across page reloads (via `localStorage`), so
    reopening or refreshing the dashboard reselects the same server instead of always
    falling back to the first one in the list.
  - Responsive layout below 700px wide (phones/small tablets): the sidebar becomes a
    horizontal bar across the top instead of a left column, and the console and online
    players panels stack vertically instead of side by side, with the console on top and
    the player list below it as a horizontally wrapping row of names instead of a tall
    vertical list. The desktop layout is a fixed-viewport "app" (nothing outside a panel
    scrolls); on mobile the page scrolls normally instead, since a panel that isn't
    explicitly height-capped kept turning out to grow past the screen with nothing able to
    reach the overflow - everything except the console just flows and the page grows to
    fit it. The live console feed keeps a fixed height (55% of the screen's height) so it
    stays a compact, auto-scrolling box instead of growing to fit however many backlog
    lines happen to be loaded - relying on flex-grow to size it dynamically here turned out
    not to reliably bound it on real mobile browsers the way it does on desktop, even
    though it worked in every headless test; an explicit height sidesteps that. Its text is
    also a size smaller there than on desktop, so a long line (a lot of the ARK log's own
    lines run long) wraps across fewer rows and more of the recent history fits in that
    fixed-height box at once.
  - **Analytics** - a **Server Status** box first (State as the same colored pill badge
    used elsewhere/Players/CPU/RAM/Version/Uptime, live-ticking every second off `startedAt`
    exactly like Console's own Status box/Backup task status and Next backup in, reusing the
    exact same `GET /api/servers/:id/backups/status` route the Backup tab itself calls,
    rather than a separate endpoint) - the same fields the desktop Manager's own Analytics
    tab shows under its own "Server Status" heading, minus PID/build ID/the file-shortcut
    buttons/the update-check panel, none of which have a meaningful remote equivalent.
    **Backup task status** is colored the same way as the desktop tab's own field
    (`status-ok`/`status-warn`/`status-offline` - green when a schedule is armed, amber when
    enabled but not currently active, red/muted when the server itself is offline). Below
    that, a **Time Scale** row (1m through All, a separate button set and a separate
    per-profile `localStorage` key from the Cluster Dashboard's, so picking a scale here
    doesn't change what a group's own chart shows) with an **Enable stats collection**
    checkbox to its right (shortened from "Enable stats collection for this server" - the tab
    itself already makes clear which server it's for) - mirrors the desktop Analytics tab's
    own toggle (`ServerProfile.statsEnabled`); unlike that checkbox, toggling it here is
    itself a profile write, so it goes through the same admin-gated `POST
    /api/servers/:id/profile` route as Settings/Mods and is disabled client-side for any role
    below admin (the tab itself stays open to every role, same as Console/Backup - viewing an
    already-enabled server's history, or its Status box, needs no special permission). Below
    that, the same CPU/RAM/Players sparkline chart as the Cluster Dashboard's own per-group
    chart above, just fed one server's own history instead of several summed together -
    literally the same `buildClusterChart`/`buildSparkline` drawing code, reused rather than
    reimplemented. A `GET /api/servers/:id/stats` route (`readonly`, backed by the same
    `readStatsHistory` the desktop Manager's own IPC channel calls) feeds the chart,
    downsampled to the same 500-point budget and polled every 5s while the tab is open. Once
    stats are enabled but no samples exist yet, the chart area shows "Collecting data..." only
    while the server is actually running - a stopped server instead shows "Server isn't
    running - start it to see live stats.", matching the desktop Analytics tab's own
    conditional, rather than perpetually implying data collection is imminent for a server
    that isn't even up.
  - **Backup** - a backup menu matching the desktop app's own Backups tab, always showing
    whichever server its own picker (or any of the other seven tabs' pickers, kept in sync)
    currently has selected - switching servers anywhere, including via a Cluster Dashboard
    card click, updates this view too. A **Backup Settings** section (admin/globalAdmin only
    - hidden entirely for lower roles, same pattern as Settings/Mods) lets an admin token
    edit the backup directory, max backups to keep, the scheduled-backup toggle and its cron
    expression, and the player-profile-backup toggle/per-player retention count, each saving
    immediately on change through the same admin-gated `POST /api/servers/:id/profile` route
    as Settings/Mods - full parity with the desktop tab's own settings form, short of the
    **Browse...** directory picker button (no local file-system dialog to open remotely; type
    the path directly instead). Below that, the same directory/retention/schedule summary
    line as before (now doubling as live confirmation that a setting just saved actually
    took). Every other role sees that summary line only, exactly as before - everything the
    rest of this view's own routes can do is act on backups that already exist
    (create/restore/delete), not reconfigure how they're taken. A **Create backup now** button
    and **Refresh** button sit above a three-column row - matching the desktop Backups tab's
    own World Backups/Player Profile Backups/Backup Process Log layout (45%/30%/25% of the
    row's width, since world backup file names run longer than the other two columns need):
    **World Backups** (file name, size, creation time, each row with its own **Restore** and
    **Delete** actions, both confirming before acting), **Player Profile Backups** (a
    dropdown of every player who has at least one backup, with its own **Refresh** button,
    next to a checkbox-selectable table of that player's backups and **Restore
    selected backup**/**Delete selected backup(s)** buttons above it - restoring or deleting
    a player backup reuses the exact same `/backups/restore`/`/backups/delete` routes as
    World Backups, since both are just a file path to either function), and **Backup Process
    Log** - polling every 5s while this view is active. Restore/Delete on both backup tables
    are admin/globalAdmin only, same as the desktop app's own equivalent actions; every other
    role sees the tables read-only. On a phone, the World Backups table only shows the 10
    most recent by default (however many the retention setting actually keeps could be a lot
    more than that, and scrolling through all of them just to reach the log below gets old
    fast) - a **Show all N backups** button underneath reveals the rest, toggling back to
    **Show fewer**; desktop always shows the full list, no cap (the Player Profile Backups
    table has no such cap - a single player's own backup count rarely gets that large). All
    of it backed by the same `backup.ts`/`schedule.ts`/`playerBackup.ts` functions the
    desktop Backups tab uses, reused directly since the web dashboard runs in the same
    process. No remote equivalent for the desktop tab's **Open backup folder** button on
    either table, same as everywhere else on this page a local file-system dialog would be
    needed.
  - **Settings**, **Mods**, **Map Management**, and **Update Log** - admin-only tabs (role
    `admin`/`globalAdmin`, or no login requirement at all) that let an admin token do
    essentially everything the desktop Manager's own per-server Settings/Mods/Map
    Management/Update Log tabs can, without any local file-system access (no directory/file
    picker, no "open folder" button - those stay desktop-only, they have no remote
    equivalent). Each follows whatever server is currently selected exactly like Backup
    above, with the same "No server selected - choose one above." fallback. **Settings**
    covers Name/Install directory/ports/Platform/Max Players/Map (official + custom, from the
    same `maps.json`/`customMaps.json` the desktop Manager reads)/Mod Map/Beta/culture/
    BattlEye/RCON Tribe Log/Force Respawn Dinos/No Sound/Max Dino Level/Dashboard group/Extra
    launch arguments/Cluster settings. **Mods** is the same enable/passive/dev checkboxes, name, and
    mod ID table as the desktop tab, add/remove included. **Map Management** creates/lists/
    deletes `SavedArks/<folder>/<file>` placeholders. **Update Log** is a read-only view of
    the last SteamCMD run's output, refreshing every few seconds while open, same as the
    desktop tab's live-updating version. Every field saves immediately on change (no separate
    Save button), each through its own `POST /api/servers/:id/profile` call (Mods reuses this
    same route; Map Management gets its own `GET`/`POST /api/servers/:id/mapfolders` and
    `POST .../mapfolders/delete`; Settings additionally reads `GET /api/maps` for its Map
    dropdown) - all gated by `requireRole(req, res, 'admin')` server-side regardless of what
    the sidebar does or doesn't show client-side, and still scoped by a token's per-profile
    access list the same as every other per-server route on this page.
  - **Server Management** - a `moderator`-and-above tab (a wider tier than the four above -
    moderators are meant to reach it), covering the startup/crash-watchdog/zombie-detection
    toggles, the cluster console archive size, and the scheduled Restart/Dino Wipe
    day-and-time pickers, including the same live "Next shutdown/dinowipe in: DD:HH:MM:SS"
    countdown as the desktop tab - `computeNextOccurrence`/`formatCountdown`
    (`shared/scheduleTime.ts`) hand-ported into this page's own vanilla-JS client script
    (which has no module system to import the real ones from) and ticking once a second
    while this tab is open, same cadence as desktop. Unlike the four admin-only tabs above,
    it has its own dedicated `GET`/`POST /api/servers/:id/servermanagement` route rather than
    reusing the generic `/profile` route - a hardcoded whitelist of just the fields this tab
    edits, so a moderator-tier credential reaching it can never read or write anything else
    on the profile (install directory, ports, mods, backup settings, etc. all stay behind the
    admin-only `/profile` route). Saves immediately on change, same as the other tabs.
  - Every one of these routes - `/profile`, `/servermanagement`, and the Backup tab's own
    settings fields - keeps the desktop Manager itself fully in sync with an edit made here,
    the same two ways an edit made in the desktop app itself already does: any restart/dino
    wipe/backup schedule or the player-profile-backup watcher gets re-armed against the new
    values immediately (not just on the Manager's next restart), and every open desktop
    window's own profile list updates live too - a field changed from a phone shows up in the
    Manager's Settings/Server Management/Backups tab (if it's open to that same server)
    without needing a manual refresh. The second part is a small dedicated event
    (`profileEvents` in `store.ts`, forwarded to every renderer window as `IPC.profilesChanged`)
    that fires on every profile save regardless of what triggered it, specifically so this
    doesn't require the web dashboard's HTTP routes to know anything about the desktop UI at
    all.
  - Cluster Dashboard is always the tab this page opens on - there's no remembered-last-view
    restore across reloads the way earlier versions of this page had. The eight per-server
    tabs above only ever enter the sidebar through an explicit click on a card in a group's
    mobile Group Console - nothing pre-selects a server on load, unlike before. Once a
    server has been selected at least once this session, those tabs (and their shared
    server pickers) stay in the sidebar even if the selection is later cleared (e.g. that
    profile got deleted or hidden out from under the page) - only the currently active view
    falls back to Cluster Dashboard in that case, not
    the whole sidebar collapsing back to just Cluster Dashboard.
  - **Host** controls who can reach the page at all - `127.0.0.1` (default) keeps it
    reachable from this machine only. Setting it to `0.0.0.0` (all interfaces) or one
    specific local IP makes it reachable from other devices on your local network, which
    Settings shows a warning for once set unless **Require access token** (below) is also
    on: by default the page has no authentication of its own, so that's full RCON/admin
    control of your servers available to anyone who can reach that address - only do this
    on a network you trust. Settings lists this machine's own local IPs as a hint for what
    to type in. Enabling/disabling, or changing the host or port, takes effect immediately
    on Save, no restart needed.
  - **Require access token (HTTPS)** - a checkbox in Settings, off by default (nothing
    changes for existing setups unless you turn it on). Turning it on does two things:
    switches the dashboard from plain HTTP to `https://` using a self-signed certificate the
    Manager generates and caches itself (`<data folder>/certs/`, regenerated automatically
    if this machine's local IPs change; browsers will show a "not trusted" warning the first
    time you visit - that's expected for a self-signed cert, click through, or install
    `certs/cert.pem` as trusted on a device if you'd rather not see it again), and requires
    every browser to present a valid access token before the page or any of its API routes
    respond to anything. This is what makes it reasonable to expose the dashboard outside
    your LAN (e.g. via router port forwarding) - without it, anyone who can reach the
    address has full control either way. There are no accounts, usernames, or passwords
    anywhere in this app - just tokens.
    - **Access tokens** are managed only from this Settings screen, never from the
      dashboard page itself - so having a token never grants the ability to create or
      revoke tokens, that always requires being at the machine running the Manager. Each
      token has a label (just for telling tokens apart, e.g. "My laptop") and one of four
      roles, highest to lowest: **Global Admin** (everything, on every server, always -
      the only role that ignores the per-server scoping described below even if one is
      set on the token), **Admin** (the exact same full permission set as Global Admin -
      Settings/Mods/Map Management/Update Log, full remote profile editing - but restricted
      to whichever servers the token is scoped to, same as every other role), **Moderator**
      (Console/Analytics/Backup/Cluster Dashboard plus **Server Management** - start/stop/
      restart/update a server, send RCON commands, create backups - but not restore or
      delete them, not Settings/Mods/Map Management/Update Log, and not the event-label
      filter checkboxes, which are shared/global rather than per-token), and **Read-only**
      (Cluster Dashboard plus a server's console feed and online players list, with every
      action hidden - no Backup section, no Start/Stop/RCON, no Kick, nothing that writes).
      A token created before this four-tier split existed keeps working exactly as it did:
      a stored `admin` role becomes **Global Admin** (it already meant unrestricted access
      before per-server scoping existed) and a stored `operator` role becomes **Moderator**,
      migrated automatically the first time the Manager reads the stored lists after
      updating, no action needed - and, critically, only that once, ever: a token created
      afterward with the (also now-legitimate) `admin` role is never itself touched by this
      migration, so creating a new **Admin** token keeps it exactly that, not silently
      promoted to Global Admin the way an earlier version of this migration incorrectly did
      on every single read. Role checks happen on the server for every route regardless of
      what the page shows - the
      client-side hiding is just so a role never sees a button that would fail if clicked. A
      token's full value (`ark_<id>_<secret>`) is shown exactly once, right after creating it
      - only its hash is ever stored, so a lost token can't be recovered, only revoked and
      replaced with a new one. To use one, paste it into the small prompt the dashboard page
      shows the first time a browser opens it without a token; that browser then remembers it
      (in its own `localStorage`, never a cookie or server-side session) until it's cleared,
      the token is revoked from Settings, or **Log out** is clicked - unlike a login session,
      a stored token survives a Manager restart or the dashboard being turned off and back
      on, so a browser only has to paste it in once.
    - Each access token can also be scoped to a chosen subset of servers, via a dropdown
      next to the label/role fields when creating one - a button showing the current
      selection ("All servers", one name, or a count) opens a scrollable checklist, one
      checkbox per server, rather than requiring Ctrl/Cmd-click. Nothing checked, the
      default, means every server - including ones added later, same as a token created
      before this existed. Choosing **Global Admin** hides/disables this picker entirely
      (it shows "All servers" and can't be changed) since that role structurally ignores
      scoping either way - pick **Admin** instead for a token that should be limited to
      specific servers while still having full permissions on them. This is enforced on the
      server for every route that operates on a specific server or group, not just filtered
      out of what the dashboard page displays - a direct API call for a server outside a
      token's scope gets the same 404 as a genuinely unknown server, rather than exposing
      that the server exists at all. The tokens table shows each one's scope as "All" or the
      list of server names it's restricted to.
    - An existing token's role and server scope (and an API key's role) can be changed any
      time via **Edit** in its table row, which swaps that row for the same role/scope
      picker the create form uses, with **Save**/**Cancel** in place of the label/Create
      button - no need to delete and recreate a token just to widen or narrow what it can
      do. Saving only ever changes the role/scope fields; the token's own secret (and so the
      value already pasted into a browser, or configured into a bot) is untouched, so editing
      permissions never logs anyone out or breaks an existing integration the way
      delete-and-recreate would.
    - **API keys** (also managed only from this Settings screen, kept as their own separate
      list from access tokens) are the same idea, but for scripts/bots that call the
      dashboard's HTTP API directly rather than a person's browser - e.g. a Discord bot
      posting server status. Each key has a label, a role (same four as access tokens - Admin
      and Global Admin behave identically for a key, since keys aren't scoped to specific
      servers the way access tokens can be), and is sent as `Authorization: Bearer <key>`
      exactly like an access token is - the server checks a presented Bearer credential
      against both lists, so either kind works anywhere the other does. A key's full value is
      shown exactly once at creation, same as an access token, and its role can likewise be
      changed any time via **Edit** without touching its secret.
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
  `-ServerRCONOutputTribeLogs`), Force Respawn Wild Dinos (`-ForceRespawnDinos`), No
  Sound (`-nosound`), and Max Dino Level (`-DestroyTamesOverLevel=<value>`, omitted
  entirely when left blank). RCON itself is always on (the Manager depends on it for
  Stop/Restart and the web dashboard) and can't be turned off, so there's no toggle or
  indicator for it in the UI at all.
- **Server Management tab** — **Manager Startup**, **Anti-Crash Watchdog**, **Zombie
  Detection**, and **Cluster Console Log Archive** share one **Startup & Watchdog** card
  (in that order, each its own labeled subsection with a one-line description rather than
  a full paragraph). The two schedules - **Restart** (renamed from "Server Shutdown,
  Update, and Startup") and **Dino Wipe** - share their own **Advanced Schedule** card
  right after the Watchdog group, again as labeled subsections rather than two separate
  cards. None of the underlying behavior changed - just how it's grouped and worded on the
  page. Each schedule's day-of-week checkboxes (Sun-Sat) sit on their own row below the
  enable checkbox + time input, rather than sharing a row with them and wrapping onto a
  second, misaligned row once the card isn't wide enough for all nine controls at once. An
  **Anti-Crash Watchdog** checkbox, independent per profile:
  when enabled, if this server is found to have gone from `running` (i.e. fully Started, not
  merely `starting`) straight to `stopped` with no deliberate action in between, it's
  restarted automatically 15 seconds after detection. A crash during startup itself (never
  reaching `running` in the first place) is a startup failure, not "a running server that
  crashed" - deliberately not retried, since blindly retrying every 15s would just loop
  forever on a fundamentally broken config. The running→stopped transition is only ever
  reached for a genuinely confirmed crash to begin with - Stop, Kill, Restart, Update, and
  the scheduled restart below all set a `stopping`/`restarting` status before ever touching
  the process (see "Tolerates a process hand-off..." above for how a stopped status gets to
  be trustworthy in the first place), so none of those are ever mistaken for one; Stop,
  Kill, and Restart also explicitly cancel any already-pending auto-restart themselves as a
  second layer of certainty, on top of never being able to trigger a new one. The checkbox
  is re-checked right before the restart actually fires, so turning it off during the 15s
  wait cancels it too.
- **Zombie Detection** — the Watchdog above deliberately leaves a startup failure alone (see
  just above); this is its counterpart for that exact gap. Independent per profile, active
  only during the window between the process spawning (`starting`) and the Manager
  confirming it actually finished loading (`running`) - armed the moment a profile enters
  `starting`, and disarmed the instant it leaves `starting` for any reason. If it's still
  stuck `starting` after a configurable timeout (default 10 minutes), the process is killed
  as a zombie caught in an endless startup loop, optionally (a separate checkbox, per
  profile) followed by an automatic restart attempt once the kill is confirmed complete.
  Both the enabled flag and the auto-restart choice are re-checked right before they'd take
  effect, same as the Watchdog above.
- The Server Management tab also has a "Start this server when the Manager starts" checkbox
  (not to be confused with "Start Manager when you log into Windows" in Settings, which is
  about the Manager application itself): when enabled, this server is started automatically
  every time the Manager app launches - skipped if it's already running (e.g. re-adopted
  from a previous Manager session that never actually stopped it). Waits for the "Delay
  between auto-started servers" setting in Settings (default 10s) before starting - even if
  it's the only enabled profile - so the Manager's own monitoring has time to finish
  initializing first and picks up this server's telemetry correctly from the start. When
  several profiles have this enabled, they start one after another, each waiting that same
  delay after the previous one. Also home to two independent time/day-of-week schedules,
  each with a live "next occurrence" countdown (`DD:HH:MM:SS`):
  - **Scheduled restart** ("Shutdown server at:" + Sun-Sat day checkboxes) gracefully
    stops the server (SaveWorld confirmed, then DoExit - the same path as the manual Stop
    button) at that time on the selected days, then optionally, in order: **Update server
    from steam after shutdown** (runs the same SteamCMD update as the Update button) and
    **Start server after shutdown**. When the update option is on, it waits 10 seconds
    after the shutdown before starting SteamCMD (`src/main/lib/scheduledActions.ts`,
    `POST_STOP_UPDATE_DELAY_MS`) - a grace period for the OS to fully release the install
    directory's file handles (log/save files) rather than racing SteamCMD against a
    process that just exited. The server is locked from being started manually (Dashboard,
    server page, or the web dashboard) for that whole 10s window, not just while SteamCMD
    is actually running - the same `isUpdating` guard the manual Update button itself uses
    is reserved as soon as the shutdown completes, so a manual Start can't sneak in and race
    the scheduled update. Since this runs unattended, its outcome (success, or a
    failure - including one that never even got to spawn SteamCMD, e.g. no SteamCMD path
    configured) is appended to that server's usual update log, viewable in that server's
    **Update Log** tab, the same place a manual Update's output shows up.
  - **Scheduled dino wipe** is independent of the restart above: its own time/day picker
    that just sends RCON `DestroyWildDinos` directly, while the server is running - no
    shutdown involved.
  Both schedules are profile settings like any other (included in profile export/import)
  and save immediately on every change - no separate Save button, and no need to restart
  the server or the Manager for a change to take effect.
- **Update / install via SteamCMD** — a per-server button runs
  `steamcmd +force_install_dir <install dir> +login anonymous +app_update 2430930 validate +quit`.
  A **Beta** field at the end of the Settings tab's Server block (a checkbox plus a
  branch-name text entry) inserts `-beta <name>` right before `validate` when checked and a
  name is given, targeting that beta branch instead of the default/public one - same command
  otherwise. Works for a first-time install into an empty folder too - the button reads **Install**
  instead of **Update** until the server executable is actually found in the install
  directory, then switches over automatically. Disabled while the server is running or
  already updating. The dashboard's own **SteamCMD** menu can either download and
  manage its own SteamCMD copy (one click, no setup) or point at an existing install you
  already have. The managed copy installs into a `steamcmd` folder inside the "Data files
  location" (see Settings below - Documents/ARK Server Manager by default), not next to
  the packaged app's executable: electron-builder's NSIS installer wipes the install
  folder's contents on every update/rebuild, which was silently deleting a managed
  SteamCMD copy kept there while the saved SteamCMD path setting kept pointing at the
  now-gone location. Each server's **Update Log** tab shows its last install/update run and
  refreshes itself live - the main process pushes an event the moment new output is written,
  rather than the tab polling on a timer, so a scheduled update's outcome shows up as it
  happens whether or not the tab was already open when it started (previously this was a
  toggleable panel on the Dashboard card itself, which only refreshed live while left open
  there). A failed attempt is retried automatically, up to 3 attempts total, before actually
  reporting an error - a stale/freshly-installed SteamCMD's very first run in a while often
  has to self-update itself first, which tends to fail once (exit code 7) before succeeding
  right after, so a single failure isn't necessarily the final outcome. A successful
  attempt - including the very first one - never triggers a retry. The update log shows
  every attempt, marked with a "Retrying" line in between.
- **Map Management tab** — type a folder name and a `.ark` file name (e.g. `Svartalfheim` /
  `Svartalfheim_WP.ark`) and click **Add map** to create `SavedArks/<folder>/<file>` under
  this server's install directory - an empty placeholder, just enough for a custom map to
  exist before its mod is actually installed (add that mod in the Mods tab afterwards -
  that's what downloads the real map and keeps it up to date). Below that, every subfolder
  already under `SavedArks` is listed (name + creation date, click a row to select it) with
  **Open map folder** and **Delete selected map** acting on whichever one is selected.
  Folder/file names are limited to a plain name - no path separators or `..` - since
  they're used to build a path on disk.
- **Update Log tab** — this server's last SteamCMD install/update run (manual or
  scheduled), moved here from a toggleable panel on the Dashboard card so it's always
  reachable and always live-refreshing rather than only while that panel happened to be
  left open - see "Update / install via SteamCMD" above for the retry/live-refresh
  behavior itself, which is unchanged.

## Manager Log

A page (sidebar **Log** button, alongside Dashboard and Cluster Dashboard) recording
everything the Manager itself does - Start/Stop/Kill/Restart (manual, from either the
Dashboard or the web dashboard), a scheduled restart's stop/update/start sequence, a
backup's save/zip sequence (manual or scheduled) and a restore, a SteamCMD update (manual
or scheduled, success or failure), and an Anti-Crash Watchdog-triggered restart -
independent of any one server's own ShooterGame.log or SteamCMD update log, and persisted
across Manager restarts (`src/main/lib/managerLog.ts`, `logs/manager.jsonl` under the Data
files location, capped at a fixed 5 MB with the oldest entries trimmed automatically once
exceeded - not a per-server setting like the cluster log archive, since this is
Manager-wide activity expected to accumulate slowly). A single action (e.g. a plain Start)
is one line; a multi-step task (the scheduled restart's Stopping/Stopped/Updating/Started
sequence, a backup's Started/Completed sequence, or the Watchdog's detected/restarting
sequence) shares one `taskId` under the hood so the page groups them under one header
showing the task's name (e.g. "Scheduled Restart — ServerName") with each step listed
underneath, rather than as unrelated lines. Grouping looks a `taskId` up across every group
seen so far, not just the most recently added one - several scheduled backups for different
servers can fire at the same moment and interleave their Started/Completed lines
chronologically, so a single backup's two lines are rarely adjacent in the raw log; only
checking the last group would otherwise split them into separate single-line groups instead
of merging like an uninterrupted, single-server scheduled restart's steps already do. Each
group is colored by event category - Start
green, Stop red, Restart orange, Kill dark red, Update light blue (matching the same colors
used for those actions elsewhere in the app), Scheduled Restart cyan, Backup purple,
Restore pink, and Anti-Crash Watchdog red - a left border plus the header text, so the kind
of event registers at a glance without reading every label. The category is inferred from
the `taskId`'s own prefix (`start-`, `backup-`, `crash-watch-`, ...) client-side, so it's
purely a display concern - an older log entry from before this existed, or any other
prefix, just renders uncolored instead of breaking. Refreshes live while the page is open -
the main process pushes each new entry as it's recorded, the same push pattern as the
Backups tab's own process log. Entries are set in a smaller, tighter font (rather than the
app's normal text size) so more of them fit on screen at once, especially on a large
monitor. An **Auto-scroll** checkbox next to the page title (unchecked by default) is the
only thing that scrolls the feed to the newest entry as new ones arrive - left off, new
entries still append live but the page stays exactly where you scrolled it, so reading
through older activity isn't constantly interrupted by a jump to the bottom. Opening the
page itself always jumps to the newest entry first either way, so it never opens on the
oldest recorded activity.

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
npm test             # unit tests for the pure logic (launch args incl. cluster flags, RCON parsing, backup rotation, profile migration, SteamCMD args/paths, process adoption, startup log-file watching, live console event parsing, web dashboard HTTP routes)
npm run dist          # package a Windows installer + portable .exe into release/ (must be run on Windows)
```

`npm run dist` produces both an NSIS installer and a standalone portable `.exe` (via
`electron-builder`) in `release/`. It has to run on an actual Windows machine - cross-
building Windows targets from Linux/macOS needs Wine for the code-signing step, which
isn't set up here. The portable `.exe` is the easiest way to right-click → "Run as
administrator" without installing anything.

## Publishing a release

For the in-app **Check for updates** button (see Features above) to find a new version,
a build has to actually reach this repo's [GitHub
Releases](https://github.com/RaptorSauvage/test-manager-ark/releases) - `electron-builder`
is already configured (`build.publish` in `package.json`) to look there.

1. Bump `version` in `package.json` (electron-updater compares this against the latest
   release's tag, so it has to actually increase - plain semver, no `v` prefix needed in
   the field itself).
2. On Windows, with a `GH_TOKEN` environment variable set to a GitHub personal access
   token that can push releases to this repo:
   ```bash
   npm run build
   npx electron-builder --win --publish always
   ```
   `--publish always` uploads the installer, the portable exe, and the `latest.yml`
   metadata file electron-updater actually reads, as a new draft/published GitHub Release
   tagged with the `package.json` version. Without a `GH_TOKEN` (e.g. just running
   `npm run dist`), electron-builder still builds normally into `release/` but skips
   publishing - you'd need to attach the installer and `latest.yml` from `release/` to a
   GitHub Release by hand for the update check to see it.
3. Every installed copy of the Manager will then find it next time someone clicks
   **Check for updates**. There's no forced/background check on a schedule - it's
   deliberately opt-in per click, same as the SteamCMD update button for the ARK server
   itself.

Since the repo is public, no token is needed on the *reading* side - `electron-updater`
downloads release assets anonymously, `GH_TOKEN` is only for the publish step above.

## Setting up a server profile

From the dashboard, click **+ Add server**, then open it and fill in the **Settings**
tab:

- Every tab auto-saves immediately - there's no Save button anywhere in a server's own
  tabs (Settings, Mods, Backups, Server Management), and no debounce delay either: each
  field/checkbox/reorder/drag is written to disk the moment you make it, the same way the
  Server Management tab always has. Saving a profile also re-applies its backup/restart/
  dino-wipe schedules and the player-backup watcher, so this happens on every edit, not
  just eventually.
- The Settings and Server Management tabs both lay their sections out as wrapping cards
  (`.server-settings-tab`/`.server-management-tab` in `styles.css`) rather than one narrow
  column down the left with the rest of the window empty - each section keeps a consistent
  width and the sections flow across the available width, as many per row as fit, dropping
  to fewer (down to one) on a narrower window.
- Settings groups **Name**, **Install directory**, **Game/RCON ports**, **Server
  Platform**, **Max Players**, **Map**, and **Mod Map** together into one **Server**
  section (which also holds the **Export profile...** button at its end, rather than as a
  separate row below every section), followed by **Extra Settings** (which also holds
  **Extra launch arguments** at its end, rather than as its own standalone field below every
  section) and then **Cluster** last - all three sections share the same card treatment,
  with **Map** and **Mod Map** nested together in their own boxed subgroup within the
  **Server** section, since a custom map's Workshop mod id only matters alongside the Map
  it's paired with. **Dashboard group** (Extra Settings) has no explanatory text under it -
  see "Dashboard" above for what it does.
  **Install directory** is the folder containing `ShooterGame/Binaries/...` for that
  server instance - **Browse...** opens a folder picker; pasting a path works too, and a
  surrounding pair of quotes (e.g. from Windows Explorer's "Copy as path") is stripped
  automatically so that doesn't silently break detection. **Game/RCON ports** and
  **Server Platform** (PC/ALL): RCON authenticates using `ServerAdminPassword` from that
  install's `GameUserSettings.ini` - set it there, not in this app - and must be reachable
  on `127.0.0.1` (start/stop rely on it to save the world before shutting down).
- **Map**: a dropdown with two groups, **Official** (from `maps.json`) and **Custom**
  (from `customMaps.json`) - same folder (Documents/ARK Server Manager by default - not
  next to the Manager executable, since electron-builder's NSIS installer wipes that
  folder's contents on every update; Documents is untouched by that and by swapping the
  portable exe) and shape for both files, just two separate lists. A seed list of the
  official maps is created in `maps.json` on first run; `customMaps.json` starts empty
  since custom/modded maps are specific to whatever Workshop mods you use - add a line for
  each (its real map identifier, exactly like an official map's, plus a display name) with
  no app update needed. Either group is a plain, direct pick: selecting one just sets this
  server's map, same as picking an official one always did - there's no more indirection
  through Mod Map below. A profile's current map is always shown even if it isn't (or
  isn't yet) in either file. Next to the dropdown, **Open Folder** opens that same
  Documents/ARK Server Manager folder directly (so you can edit `maps.json`/
  `customMaps.json` by hand without hunting for the path yourself), and **Refresh** reloads
  both files on demand after an edit.
- **Mod Map** - a separate "Enable Modded Map" toggle for Workshop-based custom maps that
  also need their mod id passed explicitly: paste the mod's Workshop id and, while enabled,
  it's passed as `-MapModID=<id>` alongside the Map value above. Fully manual and
  independent from Map - nothing else in this app ever reads, writes, or clears it besides
  you typing into it and toggling the checkbox.
- Backups always read/write `ShooterGame/Saved/SavedArks/<map>` under the install
  directory - only the profile's own map subfolder, not the whole `SavedArks` folder (it
  can hold other maps' saves too, e.g. on a shared cluster install). This location is
  fixed by ARK:SA and isn't a configurable field. `.arkrbf` files (ARK's own transient
  rollback data, not useful in a backup) are left out of the zip. Backup directory,
  retention, and scheduling live in the **Backups** tab, not here; you must set a backup
  directory there before creating a backup. The Backups tab's list and the maxBackups
  retention limit both just take every `.zip` file sitting in that backup directory,
  whatever its name - including ones from a previous manager tool, or dropped in by hand.
  There's no separate "own vs. legacy" tracking: everything in that folder counts the
  same, and once you're past the configured limit the oldest file(s) - by whoever created
  them - get deleted to make room, so keep a server's backup directory dedicated to that
  server if you don't want unrelated zips swept up in its retention.

## Web dashboard API (for bots / other tools)

Everything the web dashboard page itself calls is plain JSON over HTTP - nothing
dashboard-page-specific about it, so any other local process (a Discord bot, a script,
`curl`) on the same machine can call it too, once **Settings → Enable web dashboard** is
on. Base URL is `http://<host>:<port>` using whatever Host/Port you set there (defaults
to `http://127.0.0.1:8090`) - or `https://` if **Require access token** is also on. With
that off (the default), there's no authentication at all - the same posture as RCON
itself, appropriate for `127.0.0.1` or a trusted LAN, never the open internet. With it on,
every route below needs a valid Bearer credential, with enough role to match the table in
the Settings section above:
- **API key** (the option meant for a bot/script) - create one in **Settings → API keys**,
  then send `Authorization: Bearer <key>` on every request. Keeps working across Manager
  restarts.
- **Access token** (what a browser uses, but works identically for a script) - create one
  in **Settings → Web dashboard access tokens**, then send it the same way:
  `Authorization: Bearer <token>`. There's no separate login step or cookie for either
  kind - the server checks a presented Bearer credential against both lists, so an access
  token works anywhere an API key does and vice versa; they're only kept as separate lists
  for organizing who has what.
- `GET /api/whoami` - what the dashboard page itself calls right after a browser pastes in
  a token, to learn its role. Returns
  `{ "role": "globalAdmin" | "admin" | "moderator" | "readonly" }` for any valid credential,
  401 for an invalid or missing one - useful for a script to sanity-check a key/token before
  using it for anything else.

| Method | Path | Body | Response | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/whoami` | — | `{ role }` | 401 if the presented key/token is missing or invalid |
| GET | `/api/servers` | — | `[{ id, name, group, maxPlayers, state, players, cpu, memoryMB, startedAt, gameVersion }]` | `id` is what every other endpoint below expects; `group` is the Manager's dashboard group name (empty string when ungrouped); `startedAt` (epoch ms, or `null`) feeds the Status panel's live Uptime field |
| GET | `/api/groups/:group/events` | — | Same shape as `/api/servers/:id/events` below, plus `profileId`/`profileName` on each event | Merged, date+time-sorted backlog across every server in the group. `:group` is the group name, or the literal `_ungrouped_` for the ungrouped bucket |
| GET | `/api/groups/:group/events/stream` | — | `text/event-stream`, one `data:` line per merged event (same shape as the backlog above) | Only tails servers in the group that are actually running, starting/stopping individual tailers live as they start/stop while the connection is open. With auth on, `EventSource` can't set an `Authorization` header, so this route (and the per-server one below) also accepts the credential as a `?token=` query parameter |
| POST | `/api/servers/:id/start` | — | `{ ok, error? }` | 400 with `error` if it can't start right now (e.g. an update is running) |
| POST | `/api/servers/:id/stop` | — | `{ ok: true, saved: boolean }` | Waits for SaveWorld's RCON outcome (`saved`) before responding, then returns - the rest of the shutdown keeps running in the background; state changes (`stopping` → `stopped`) show up in the next `GET /api/servers` poll. `saved: false` means RCON was unreachable or the save failed, so it skipped straight to the grace-period/force-kill fallback |
| POST | `/api/servers/:id/restart` | — | `{ ok: true, saved: boolean }` | Same as stop above, for the shutdown half - responds once `saved` is known, then the restart (including starting back up) continues in the background |
| POST | `/api/servers/:id/update` | — | `{ ok: true }` | Runs the SteamCMD update alone; fails quietly (logged in the Manager's own console) if the server is currently running - stop it first |
| POST | `/api/servers/:id/stop-update-restart` | — | `{ ok: true }` | Stops if running, updates, starts back up - the single-server "do everything" action |
| POST | `/api/servers/:id/rcon` | `{ "command": "Broadcast hello" }` | `{ ok, response? , error? }` | Same RCON connection the page's own console box uses |
| GET | `/api/servers/:id/players` | — | `[{ name, id }]` | Fresh `ListPlayers` call every time, not cached |
| GET | `/api/servers/:id/backups/status` | — | `{ backupDir, maxBackups, scheduleEnabled, scheduleCron, scheduleActive, nextRunAt, playerProfileBackupEnabled, playerProfileBackupMaxPerPlayer }` | Read-only - mirrors the Backups tab's settings; an `admin`/`globalAdmin` credential can change them via `POST /api/servers/:id/profile` (not listed here - same generic route Settings/Mods use) |
| GET | `/api/servers/:id/backups` | — | `[{ fileName, filePath, sizeBytes, createdAt }]` | Same list the Backups tab shows |
| POST | `/api/servers/:id/backups` | — | `{ ok, entry? , error? }` | Creates a backup now (sends RCON SaveWorld first, same as the desktop app); 400 if no backup directory is set |
| POST | `/api/servers/:id/backups/restore` | `{ "filePath": "..." }` | `{ ok, error? }` | Same restore-blocked-while-running guard as the desktop app |
| POST | `/api/servers/:id/backups/delete` | `{ "filePath": "..." }` | `{ ok, error? }` | Deletes one backup file |
| GET | `/api/servers/:id/backups/log` | — | `[{ timestamp, level, message }]` | The same Backup Process Log shown in the Backups tab / web Backup view |

A minimal example from a Node.js bot (works the same from Python, or any HTTP client):

```js
const BASE = 'http://127.0.0.1:8090'

async function startServer(profileId) {
  const res = await fetch(`${BASE}/api/servers/${profileId}/start`, { method: 'POST' })
  return res.json() // { ok: true } or { ok: false, error: '...' }
}

async function findProfileIdByName(name) {
  const servers = await (await fetch(`${BASE}/api/servers`)).json()
  return servers.find((s) => s.name === name)?.id
}
```

- **Manager-wide: worked around a field that silently stops accepting keystrokes after a
  confirm dialog, not disabled-looking, just unresponsive.** Reported as intermittent and
  not tied to any one field - "I can type into it once, then never again, all over the
  app." The lead: `window.confirm()` in Electron isn't an in-page dialog, it's a real native
  OS one, and Electron/Windows sometimes fails to hand OS-level keyboard focus back to the
  main window once it closes - the window looks completely normal afterward (nothing
  disabled), but no text field anywhere accepts keystrokes until it's explicitly refocused
  (e.g. alt-tabbing away and back). Every `confirm(...)` call in the app (delete/force-kill
  prompts - Dashboard, Minecraft Dashboard, Backups, Player Backups, Map Management, access
  tokens, API keys) now goes through a new `confirmAction()` helper
  (`src/renderer/src/lib/confirmAction.ts`) that calls a new `system:focus-window` IPC
  handler (`ipc/system.ts`) right after, explicitly re-focusing the main window. The
  existing file/folder pickers (`dialog.ts`) - also real native dialogs - got the same
  `mainWindow.focus()` call added directly on the main-process side. This is the most
  likely cause given the symptoms (unresponsive but not disabled, happens after a
  destructive-action prompt, affects arbitrary fields afterward rather than one specific
  one) and the fix is safe either way (an explicit refocus is a no-op if focus was never
  actually lost) - but it's a strong lead based on the reported symptoms, not something
  confirmed by reproducing it directly, since this environment has no display to test
  Electron's actual window-focus behavior in. Please confirm whether this actually resolves
  it after updating.

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
- **Multi-game support**, being built incrementally on the `multi-game-support` branch.
  Every server profile carries a `game` field (`shared/games.ts`'s registry) - `'ark-ascended'`
  for every profile saved before this existed (backfilled automatically, and persisted to
  disk the first time any profile list is read after updating - `store.ts`'s
  `migrateProfilesToDiskOnce`, same one-time-flag pattern as the role migration below - so
  `config.json` reflects it after simply opening the app once, no manual edit needed).
  **ARK: Survival Evolved is now a second, real, launchable game** alongside ARK: Survival
  Ascended (Palworld remains planned, listed for visibility only in Settings' **Games**
  section but not yet creatable; Minecraft is real too now, but as its own separate
  top-level menu rather than a third entry in this picker - see **Minecraft support**
  below for why):
  - The Settings tab's **Server** section has a **Game** picker; switching it clears the Map
    field (the two games' map ids don't match, e.g. `TheIsland_WP` vs `TheIsland`) and
    refetches that game's own map list.
  - "Import existing server" auto-detects which game an install directory belongs to from
    its executable (`ArkAscendedServer.exe`/`ShooterGameServer.exe` on Windows, no extension
    on Linux) - no need to say up front which one it is.
  - ARK: Survival Evolved's dedicated server installs/updates via SteamCMD app id `376030`
    (ARK: Survival Ascended's `2430930`) into its own `appmanifest_376030.acf`, so the two
    can coexist. Its map list defaults to the classic un-suffixed names (`TheIsland`,
    `TheCenter`, `ScorchedEarth_P`, `Ragnarok`, `Aberration_P`, `Extinction`, `Valguero_P`,
    `CrystalIsles`, `Genesis`, `Gen2`, `LostIsland`, `Fjordur`) and is stored separately
    (`maps-ark-evolved.json`, next to the existing `maps.json` which stays ARK: Survival
    Ascended's and untouched).
  - ARK: Survival Evolved needs a `QueryPort` distinct from the game port (ARK: Survival
    Ascended merged the two) - the Settings tab shows a **Query port** field only for a game
    that needs it (`GameDefinition.usesQueryPort`).
  - ARK: Survival Evolved's launch line differs from ARK: Survival Ascended's in a few more
    ways, confirmed against a real, working `ShooterGameServer.exe` command line (not just
    docs): it omits `?listen` and `-server -log` entirely, adds `-servergamelog` instead (the
    flag that actually makes it write `ShooterGame.log`, which `startServer`'s
    startup-complete-marker watch depends on), and passes `MaxPlayers=` inline in the
    `?`-string rather than `-WinLiveMaxPlayers=` (an ARK: Survival Ascended/crossplay-only
    flag). ARK: Survival Ascended's launch line is unchanged.
  - A new **Server Password** profile field (the join/connect password, distinct from the RCON
    admin password) is shown in the Settings tab and always passed as `ServerPassword=` inline
    in the `?`-string for ARK: Survival Evolved - a mandatory argument there per a real working
    command line, so it's always emitted (even blank, which just means no join password). Not
    emitted, and the field stays hidden, for ARK: Survival Ascended. A profile migrated from
    before this field existed backfills it to blank.
    - A **Session Name** field/`SessionName=` argument was added alongside this at first, then
      removed again: `GameUserSettings.ini`'s `SessionSettings.SessionName` already covers the
      in-game display name for both games, so the launch-arg duplicate for ARK: Survival
      Evolved was unnecessary. `migrateProfile` drops a stray `sessionName` from any profile
      that still has one on disk from that brief window.
  - ARK: Survival Evolved's launch line's exact **argument order** matters, confirmed the hard
    way: an earlier version reused ARK: Survival Ascended's ordering (`RCONEnabled=` right
    after `QueryPort=`, `-servergamelog` right after the map string) and that reproducibly
    caused a blocking `Plugin 'RuntimeMeshComponent' failed to load` dialog on launch - since
    the Manager starts the process detached with no visible window, nothing was there to
    dismiss it and the server hung forever. `buildLaunchArgs` now builds ARK: Survival
    Evolved's `?`-string (`Port=`, `QueryPort=`, `RCONPort=`, `RCONEnabled=`, `MaxPlayers=`,
    `ServerAdminPassword=`, `ServerPassword=` - `SessionName=` was here too at first, since
    removed, see above) and flag order (`-NoBattlEye`,
    `-ForceRespawnDinos`, `-servergamelog`, `-servergamelogincludetribelogs`,
    `-ServerRCONOutputTribeLogs`) to match a real, confirmed-working command line exactly,
    pinned by a dedicated test. Why order affects a native plugin load isn't obvious, but the
    fix is empirically confirmed. ARK: Survival Ascended's order is unchanged.
  - A handful of ARK: Survival Ascended launch flags have **unconfirmed** ARK: Survival
    Evolved support and are simply never emitted for it, rather than guessed at: crossplay
    (`-ServerPlatform=` - the Settings tab hides that field for ARK: Survival Evolved too),
    `-DestroyTamesOverLevel=` (Max Dino Level, also hidden), and passive/dev mods
    (`-passivemods=`/the `-dev` suffix - a passive-flagged mod on an ARK: Survival Evolved
    profile loads as a normal active mod instead of being silently dropped). These were
    confirmed against public documentation (Steam community discussions, LinuxGSM's ARK:SE
    docs, community wikis - the ARK wiki itself was unreachable from the environment this
    was built in), not a real running ARK: Survival Evolved install - worth double-checking
    against one before relying on it for a production server.
  - The "New update" check (SteamCMD `app_info_print` polling) and every server card's game
    icon (desktop Dashboard grid and the Web Dashboard's own cards, served from a new
    `GET /game-icons/<fileName>` route with the same ETag/no-cache pattern as `/favicon.png`)
    are both correctly scoped per game now instead of assuming ARK: Survival Ascended.
  - The Settings tab has a new **Debug** section showing the exact executable path and launch
    argument list `Start` would run right now, including unsaved edits above (a new
    `server:preview-launch-command` IPC call runs `getExecutablePath`/`buildLaunchArgs` against
    the live form state, debounced 300ms) - a **Copy** button copies the full command line.
    Added directly off the back of the `RuntimeMeshComponent` argument-order issue above, so a
    similarly obscure launch failure can be diagnosed by comparing this against a known-working
    command line instead of guessing blind.
  - `buildLaunchArgs` now drops an exact-duplicate flag rather than emitting it twice, found via
    that same Debug box on a real profile whose **Extra launch arguments** field still had
    `-servergamelog`/`-nosound` typed in manually from before the Manager started adding them
    natively for ARK: Survival Evolved - the leftover text and the native flag were both firing,
    putting `-servergamelog` on the command line twice. Only exact duplicates are dropped (first
    occurrence kept), so this is a no-op for a profile whose `extraArgs` doesn't overlap with
    anything the Manager already emits. It doesn't fix a *missing* `ServerAdminPassword=` on the
    command line, though - that's read straight from `GameUserSettings.ini` (`readAdminPassword`,
    same for both games, by design - see `config.ts`), so a server whose ini doesn't have one set
    yet (e.g. a first launch of a fresh install, before the ini has even been created) launches
    without it. `rcon.ts` already surfaces that case with a clear
    "No ServerAdminPassword set in this server's GameUserSettings.ini" error when a
    Manager-driven RCON command (Stop/Restart/etc.) is attempted against it.
  - `startServer` now spawns with `cwd` set to the executable's own directory (`Win64`/`Linux`)
    rather than the install root three folders up. Every community-standard ARK launch script
    `cd`s into that folder before running the exe (a manually confirmed working launch was run
    from inside its own `Win64` folder, cmd's prompt showing as much), so this keeps the
    Manager's spawn matching that exactly instead of leaving the working directory as one more
    unverified difference from a known-working reference. Applies to both games.
  - **ARK: Survival Evolved now launches through a temporary `.bat` file, run via
    `cmd.exe /d /c <path>`, instead of a direct `spawn()` of the exe** - every established ARK:
    Survival Evolved server manager launches this way, per further research into how they do
    it. The `.bat` (regenerated fresh on every start, at a stable per-profile path under the OS
    temp dir - `writeLaunchBatchFile` in `serverProcess.ts`) contains just a `cd /d` into the
    executable's own directory followed by the exact, unquoted command line, matching a
    confirmed-working launch byte-for-byte - this is what a person typing the command directly
    at a `cmd` prompt actually gets, and sidesteps needing Node's own Windows argument quoting
    (which wraps a space-containing argument like `SessionName=<value with spaces>` in double
    quotes - correct for a well-behaved argv parser, but plausibly mishandled by ARK: Survival
    Evolved's much older, less rigorous command-line parsing) to line up with what it expects.
    ARK: Survival Ascended is unaffected - still a direct `spawn()`, still with
    `windowsVerbatimArguments: true` (a harmless no-op there, since its arguments never contain
    a bare space) kept for parity.
    - The tricky part: this makes `cmd.exe`, not `ShooterGameServer.exe`, the process Node
      actually spawned - `child.pid` is cmd.exe's own pid, which would misreport CPU/RAM as
      cmd.exe's near-zero usage and, if killed directly, could orphan the real game process
      instead of stopping it (Windows doesn't kill a process's children when the process itself
      is killed). `watchForBatchPidHandoff` polls (every 2s, the same `findListeningPid`
      netstat-based technique `handleUnexpectedExit`'s hand-off already used) for whichever
      process actually holds the RCON port, and once found, re-points this profile's tracked
      pid at it and nulls out the stored process handle - the exact same re-attach shape
      `handleUnexpectedExit` uses for its own hand-off case - so `killServer`/the force-kill
      fallback end up targeting the real pid directly instead of the cmd.exe wrapper. Until that
      first poll succeeds, CPU/RAM monitoring is simply unavailable (`pidTracked` stays false)
      rather than showing cmd.exe's misleading numbers. `child.on('exit')` still correctly
      signals a real stop either way, since `cmd /c` waits for its child before exiting itself.
    - **Confirmed working end-to-end against a real Windows ARK: Survival Evolved install**:
      launches, is connectable in-game, and the pid hand-off below eventually completes so
      CPU/RAM monitoring comes online.
    - `watchForBatchPidHandoff` logs its progress to the **Manager Log**, under an
      `ARK: Survival Evolved pid handoff` task: the wrapper pid it started from, what
      `findListeningPid` returned on each of its first 10 attempts (~20s - capped so a
      persistently-failing hand-off can't flood the log for as long as the server stays up),
      and the real pid once found. A real ARK: Survival Evolved world can take well past 20s
      to open its RCON port (30-90s+ isn't unusual) - the hand-off itself never gives up
      (keeps retrying every 2s indefinitely), and past that initial 20s window the log gets a
      periodic reminder every ~30s that it's still looking, rather than either going silent
      (which looked exactly like it had given up, in a real report where it just needed more
      time) or framing anything as a final failure (it never is one).
  - The game-version display (Analytics tab, read from `ShooterGame.log`'s `ARK Version:
    X.Y` line) needed no ARK: Survival Evolved-specific work at all - confirmed against a
    real ARK: Survival Evolved log line (`[2026.09.28-13.19.58:026][  0]ARK Version:
    358.24`), the exact same regex already matched it.
  - A new **Auto Manage Mod** checkbox (Settings tab, Extra Settings, right before Dashboard
    group - ARK: Survival Evolved only) passes `-automanagedmods`, telling the server to
    download/update its own workshop mods itself instead of relying on them being
    pre-installed.
  - **ARK: Survival Evolved has no command-line mechanism for mods at all - confirmed, not
    just unconfirmed support as before.** It has neither passive mods nor a `-dev` suffix
    either, so the desktop Mods tab hides both columns for it. Its mods are instead written,
    only when a mods edit is actually the thing being saved (the dedicated Mods tab save, and
    the Web Dashboard's Mods tab, which posts `{mods: ...}` to the same profile-save route),
    to:
    - `GameUserSettings.ini`'s `[ServerSettings]` → `ActiveMods=<id>,<id>,...` (comma-separated,
      enabled mods only, in order)
    - `Game.ini`'s `[ModInstaller]` → one `ModIDS=<id>` line per enabled mod
    - `gameConfigWrite.ts`'s `syncAseModsToIni` does this surgically - editing only the lines
      that belong to those exact keys, not parsing+re-stringifying the whole file with the
      `ini` package (which would reorder/reformat every other section, comment and key the
      user has in a file they hand-edit themselves) - and creates the
      `Config/WindowsServer` folder tree if it doesn't exist yet (a profile whose install has
      never been started once). This is the first thing in the app that writes to either
      file - previously strictly read-only, since ARK: Survival Ascended's mods are
      launch-flag only and never needed it.
    - **Fixed a clobbering bug found via live testing before it ever shipped**: `syncAseModsToIni`
      was originally wired into every generic profile save (`profiles:save`, profile import, the
      Web Dashboard's own generic profile-save route) rather than just the dedicated mods-save
      paths. That meant saving any unrelated field - even the very first save of a brand-new
      profile - rewrote `ActiveMods=`/`[ModInstaller]` from `profile.mods`, silently overwriting
      real pre-existing ini content. Fixed by removing the call from every generic save path and
      keeping it only where a mods edit is actually the save in question; the Web Dashboard's
      shared `/api/servers/:id/profile` route now only syncs when the posted body actually has a
      `mods` key.
  - The desktop Mods tab now also **reads mods back out of the ini**: opening it for an ARK:
    Survival Evolved profile calls `reconcileAseModsFromIni`, which picks up any mod id already
    present in `ActiveMods=` that the Manager doesn't know about yet (added by hand-editing the
    ini, or from before the profile was ever opened here) and adds it as a new enabled entry.
    Additive only - it never removes or disables an existing entry, since a disabled mod is
    *correctly* absent from `ActiveMods=`, not a state to "fix". Wired via a new
    `mods:reconcile-from-ini` IPC call (`ipc/mods.ts`); not yet exposed on the Web Dashboard's
    Mods tab.
  - **Not yet done**: the Web Dashboard's own Settings tab (editing a profile from a
    browser) doesn't expose the Game/Query port fields, the new Server Password/Auto Manage
    Mod fields, or a game-aware map list the way the desktop Settings tab now does - it still
    assumes ARK: Survival Ascended for those. Its own Mods tab also still shows the
    passive/dev toggles and the `-mods=`/`-passivemods=` wording for an ARK: Survival Evolved
    profile (the desktop one now hides/rewords all of that) - inert rather than incorrect,
    since nothing reads them for it, but not hidden yet - and it has no equivalent of the
    reconcile-from-ini pickup either.

- **Minecraft support (MVP)**, built as a deliberately separate system from the ARK side of
  the app rather than a third `GameDefinition` entry - `MinecraftProfile`
  (`shared/minecraft.ts`) is its own type, its own `electron-store` collection
  (`minecraftProfiles`), its own IPC namespace (`ipc/minecraft.ts`, `window.api.minecraft.*`),
  and its own top-level menu - an **ARK / MC** switch group at the top of the sidebar,
  separated from the Dashboard/Cluster Dashboard/Log page nav below it by a divider (it
  toggles the whole app's mode, not a page within one - see `GameSwitch` in `App.tsx`).
  ARK: Survival Evolved and ARK: Survival Ascended share
  enough (engine lineage, launch style, RCON, log format) that unifying them into one
  `ServerProfile` shape made sense; Minecraft shares almost none of that - no SteamCMD, no
  fixed executable name, no `?param=` launch line, a completely different config/log format -
  so forcing it into `ServerProfile` would have meant either polluting it with fields that
  mean nothing for ARK, or a discriminated union touching every one of its consumers.
  - **Import, not install-from-scratch.** The whole point of this feature (per how it was
    scoped) is pointing the Manager at a Minecraft server folder someone already set up
    themselves, the same way MCSS does it - not driving a fresh install. "Import existing
    server" opens a folder picker; `isValidMinecraftInstall`/`detectMinecraftProfile`
    (`minecraftDetect.ts`) accept it if `server.properties`, `eula.txt`, a jar, or a launch
    script is found directly in its root (not recursively - avoids picking up an unrelated
    jar from a `mods`/`plugins`/`libraries` folder), then build a best-effort profile that's
    saved right away and opens straight into its Settings tab for review/correction - same
    "detect, save, review" flow as ARK's own import, and every Settings field auto-saves on
    change so a correction overwrites the initial guess immediately. "+ Add server" skips
    detection entirely for a from-scratch/manual entry.
  - **Dual launch mode - the Forge problem.** Vanilla/Fabric/Paper/Spigot are all a single
    directly-runnable jar, so `launchMode: 'jar'` has the Manager build
    `java -Xms.. -Xmx.. <extra JVM args> -jar <jar> <extra program args>` itself. Modern Forge
    (1.17+) ships no such jar at all - just a generated launch script plus argfiles/a
    `libraries/` folder - so `launchMode: 'script'` instead just executes an existing
    `run.bat`/`run.sh`/`start.bat`/`start.sh` as-is (via `cmd.exe /d /c` on Windows, same
    launch shape as ARK: Survival Evolved's own `.bat` launch - see `writeLaunchBatchFile` in
    `serverProcess.ts`), letting it handle its own classpath/JVM args. This also works as a
    general escape hatch for any other custom start script. `detectMinecraftLaunchable`
    prefers a script over a jar when both exist, since a script's presence is the strongest
    signal of "this needs Forge-style handling."
  - **server.properties is read live, never duplicated.** `MinecraftProfile` deliberately does
    not store its own copy of the server port, RCON port/password/enabled, motd, or max
    players - `minecraftProperties.ts` reads `server.properties` fresh on every call instead
    (a small hand-written parser, not the `ini` package - Java's flat `key=value` properties
    format has no `[Section]` headers and treats `#`/`!` as comments, not `;`). Same "the user
    manages this file themselves" philosophy as ARK's own `GameUserSettings.ini` handling -
    toggling `enable-rcon` or changing `rcon.password` while the server's running takes effect
    on the Manager's very next RCON attempt, with nothing to keep in sync.
  - **stdin is the primary command channel, RCON is secondary.** Unlike ARK's dedicated server
    (which doesn't read stdin at all on Windows, forcing RCON/log-file-only control),
    Minecraft/Java server processes support piped stdio reliably - `minecraftProcess.ts` spawns
    with `stdio: 'pipe'` and the Console tab's command box, and the graceful `stop` shutdown,
    both write straight to the running process's stdin. This works whether or not RCON is even
    enabled in `server.properties`. `minecraftRcon.ts`'s `sendMinecraftRconCommand` (same
    ECONNRESET-safe `rcon-client` connection pattern as ARK's `rcon.ts`) is used only for the
    player-list poll (`list`, parsed by `parseMinecraftPlayerList`) that feeds the Console tab
    and Dashboard cards' CPU/RAM/player stats, when RCON happens to be enabled.
  - **Live console, not a tailed log file.** Since stdio piping works reliably here (unlike
    ARK), the Console tab reads the process's own piped stdout/stderr directly rather than
    tailing `logs/latest.log` the way ARK's `ShooterGame.log` is tailed - simpler, and it also
    means a script-launched (Forge) server's output is captured too, without needing to know
    Forge's own log file layout. Kept as an in-memory ring buffer (500 lines) per server,
    intentionally not written to disk (see MVP scope cuts below).
  - **Graceful stop, not a phased save/exit handshake.** Minecraft's own `stop` command already
    saves the world, kicks players, and exits entirely on its own, so `stopServer` just writes
    it to stdin and waits (30s grace period, then force-kills) - there's no ARK-style
    `SaveWorld`-confirm-then-`DoExit` handshake to phase, since there's nothing to confirm
    separately.
  - **Script-mode pid tracking, and memory actually taking effect in script mode** (both
    fixed after a real report: CPU/RAM shown not matching the actual server, and memory
    fields not being editable at all).
    - On Windows, `launchMode: 'script'` spawns via `cmd.exe /d /c <script>`, and cmd.exe
      spawns java as a *child* process rather than replacing itself the way a POSIX shell's
      `exec` would - so the pid Node hands back is cmd.exe's own wrapper pid, not java's.
      Reading CPU/RAM off that pid showed cmd.exe's own near-zero usage instead of the real
      server's - exactly the mismatch reported. Fixed with the same technique (and same
      root cause) as ARK: Survival Evolved's own `.bat` launch:
      `watchForScriptPidHandoff` in `minecraftProcess.ts` polls (via the already-existing
      `findListeningPid` from `serverProcess.ts`) for whichever pid is actually holding the
      server's own port (`getMinecraftServerPort`) once it starts listening, and switches
      tracking to it. Until that handoff completes, CPU/RAM are left blank rather than
      shown wrong (`isPidTracked` gates `minecraftMonitor.ts`'s stats read); force-kill and
      the stop-timeout fallback now also target this tracked pid rather than the wrapper, so
      killing a script-launched server actually kills java instead of orphaning it running
      in the background.
    - The Settings tab used to disable the memory/extra-JVM-args fields entirely whenever
      `launchMode` was `'script'`, reasoning "the script already encodes its own memory
      args" - true for a fully custom script, but wrong for the common case: modern Forge's
      own generated `run.bat`/`run.sh` reads a `user_jvm_args.txt` argfile for exactly
      `-Xms`/`-Xmx`/extra JVM args (the official mechanism, not a workaround). The fields
      are no longer disabled; `startServer` now calls `writeUserJvmArgs`
      (`minecraftProperties.ts`) to (over)write that file with the profile's current values
      before every script-mode start, so editing memory in Settings takes effect on Forge's
      own generated script. Harmless no-op for an older Forge version or a fully custom
      script that doesn't happen to read that file.
  - **Explicitly cut from this first pass** (all real, deliberate scope cuts, not oversights -
    the infrastructure that made each of these work for ARK is straightforward to point at
    Minecraft later): no backups, no crash-watch/zombie detection, no persisted CPU/RAM/player
    history (only shown live while the Manager is open), no Web Dashboard integration.
    Scheduled restart and cross-restart re-adoption, both cut here originally, were added in
    a follow-up pass - see the next bullet.

- **Minecraft follow-up: server type on the card, re-adoption across a Manager restart,
  tab rework (Start Settings / Server Settings / Server Management).** Four asks from a real
  report, after using the MVP above for a bit.
  - **Server type shown on the Dashboard card**, replacing the previous jar/script file name
    display. `detectMinecraftServerType` (`minecraftDetect.ts`) is a pure, best-effort guess
    from the jar/script's own file name - it looks for `fabric`/`paper`/`spigot`/`bukkit`/
    `forge` as substrings, falls back to `forge` for any other launchMode `'script'` name
    (the actual reason that mode exists - see the MVP bullet above), and `vanilla` otherwise.
    Purely cosmetic (`MinecraftProfile.serverType`, a new field) - never affects how the
    server actually launches - and has a manual override dropdown in Start Settings for when
    the guess is wrong, right next to a description saying so.
  - **Re-adopts a still-running server across a Manager restart**, closing the MVP's own gap.
    Same shape as ARK's `adoptPersistedProcesses`: `startServer` now also persists its pid/
    start time (`store.ts`'s new `minecraftRunningPids`/`minecraftRunningStartedAt`, same
    write-resilience wrapper as ARK's own), and `adoptPersistedMinecraftProcesses`
    (`minecraftProcess.ts`, called from `main/index.ts` at boot) re-attaches to any pid still
    alive. An adopted server has no live `ChildProcess` handle (`RunningMinecraftServer.process`
    is now nullable) - so no piped stdout for the Console tab and no stdin to send commands
    to. `sendStdinCommand`/`stopServer`'s graceful stop and the IPC send-command handler all
    fall back to RCON (if enabled) for one of these; the Console tab shows a plain note
    instead of a silently-empty feed (`MinecraftServerStatus.consoleAvailable`). Force-kill
    and the stop-timeout fallback already went through a tracked pid rather than the child
    handle (see the script-mode pid-tracking fix above), so they needed no further change
    beyond `waitForExitOrKill`/`killServer` also finalizing the entry's bookkeeping manually
    for a null `process` (a live one already does this via its own `child.on('exit')`).
  - **Scheduled restart**, a new **Server Management** tab - `minecraftScheduledActions.ts`
    is the restart half only of ARK's own `scheduledActions.ts` (no SteamCMD-equivalent
    update step to schedule around, and no dino-wipe equivalent), reusing the exact same
    day-of-week + time cron mechanism (`shared/scheduleTime.ts`'s `buildDayOfWeekCron`,
    `node-cron`) and the renderer's existing `ScheduleDaysPicker` component unchanged. New
    `MinecraftProfile` fields: `scheduledRestartEnabled`/`Time`/`Days`/`StartAfter` (the last
    one, unchecked, turns it into a plain scheduled shutdown with no restart).
    `startOnManagerLaunch` moved here too from Start Settings, matching ARK's own tab layout.
  - **Server Settings, a new tab that edits server.properties itself** - the "Settings" tab
    is renamed **Start Settings** (it only ever covered how the Manager launches the process:
    jar/script, memory, ...) to make room for it. `upsertServerPropertiesKeys`
    (`minecraftProperties.ts`) is a line-based, non-destructive write: each key's existing
    `key=value` line has just its value replaced, a key with no existing line is appended,
    and everything else in the file (comments, ordering, a plugin's own custom key) is left
    untouched - never a full rewrite from parsed data, which would have silently dropped all
    of that. The tab itself mirrors MCSS's own property editor layout (Gameplay/Appearance/
    World/Networking/Miscellaneous sections, booleans as checkboxes) via two new IPC calls
    (`minecraft.properties.get`/`save`, `ipc/minecraft.ts`) - Minecraft only re-reads this
    file at its own startup, so an edit here takes effect on the server's next start, not
    live, same as editing it by hand always did.

- **Minecraft follow-up 2: layout fix, address on the card, fuller console, chat mode, icon switch.**
  - **Fixed the Server Settings tab's broken layout** (a real report, with a screenshot
    showing a large blank area and the sections not lining up). Root cause: the intro
    paragraph ("You are editing server.properties...") was a direct child of the flex-wrap
    row (`.server-settings-tab`) with no width rule of its own, so the browser sized it by
    its *unwrapped, single-line* intrinsic width - a very wide phantom flex item that pushed
    every section after it onto its own row with a large gap. The same row-wrap layout is
    shared with Server Management's `.schedule-section` row, so the CSS fix (an explicit
    `flex: 1 1 100%` for any stray `.empty-state`/`.error-message` text directly in either
    row, matching the rule that already existed just for `.error-message`) was applied to
    both, defensively.
  - **Dashboard card shows player count and a clickable IP:Port**, next to the existing
    server type - the port is read once per profile via the new `minecraft.properties.get`
    call (server-port from server.properties), the host is the machine's own first
    non-internal local network IP (`webDashboard.getLocalIps()`, already used elsewhere -
    reused rather than duplicated). Click copies `<ip>:<port>` to the clipboard (a brief
    "Copied!" replaces the text), meant for handing straight to a friend to connect with -
    `localhost` wouldn't work for anyone but the host machine, which is why this doesn't
    just show that instead.
  - **Console tab now fills the available window height** instead of leaving a large empty
    area below a fixed `60vh` box, regardless of window size.
  - **Chat mode** - a new checkbox next to Auto-scroll; while checked, whatever's typed into
    the command box is sent as `say <text>` (a broadcast chat message) instead of being sent
    as a raw server command, so the same box doubles as a way to talk to players without
    typing `say ` by hand every time.
  - **ARK/MC sidebar switch now uses icons instead of text** - the existing ARK: Survival
    Evolved game icon (already bundled for the Dashboard's own per-card game icon) for ARK,
    and a new bundled Minecraft icon (`assets/games/minecraft.png`) for MC - dimmed when not
    the active mode, full opacity when active, same "muted until active" language as the
    rest of the sidebar.

- **Minecraft follow-up 3: fixed a real crash (blank window) on Server Management, card
  reorder, trimmed descriptions.**
  - **Fixed a genuine crash**, reported as the whole Manager window going completely
    blank the instant Server Management was opened. Root cause: `serverType` and every
    `scheduledRestart*` field were added to `MinecraftProfile` in later passes, and unlike
    ARK's `ServerProfile` (which backfills newly-added fields on every read via
    `migrateProfile`, called from `listProfiles()`), nothing did the equivalent for
    Minecraft profiles - so a profile saved before those fields existed genuinely has
    `scheduledRestartDays: undefined` at runtime, despite the stored type claiming
    otherwise. `ScheduleDaysPicker` calls `.includes()` directly on that prop with no
    guard, so opening the tab threw an uncaught exception during render, and with no error
    boundary anywhere in the app, React just unmounts the entire tree - a blank window is
    exactly what an uncaught render error looks like here. Fixed with a new
    `migrateMinecraftProfile` (`minecraftProfileMigration.ts`), mirroring ARK's own
    `migrateProfile` exactly, wired into `listMinecraftProfiles()` in `store.ts`.
  - **Dashboard card: players moved next to CPU, Address moved to its own line below
    everything.** The 2-column info grid is now CPU/Players (when running) then Type/RAM,
    instead of Type/Address/Players/CPU/RAM all interleaved in one grid - Address sits on
    its own full-width line underneath the grid instead.
  - **Trimmed two descriptions down to just the parameter name/a one-line hint**: the
    Console tab's "Chat mode" checkbox no longer has a `(sends as /say)` parenthetical next
    to its label, and Server Settings' Online Mode hint was cut from a long paragraph
    (cracked servers, minecraft.net downtime, ...) down to one line.

- **Dashboard groups: reorderable, collapse persists, minimized groups skip the aggregate views.**
  - Groups on the Dashboard can now be dragged to reorder (same `⠿` drag-handle pattern as
    server cards), persisted manager-wide as `AppSettings.groupOrder`. A group not yet in that
    list falls back to alphabetical order, appended after every explicitly-ordered one, so a
    brand new group name just appears without needing to be added to the order first.
  - Collapsing/expanding a group (the native `<details>` triangle) now persists too
    (`AppSettings.collapsedGroups`) - previously the `open` attribute was hardcoded, so any
    re-render (a status tick, a new profile) silently re-expanded a group the user had just
    collapsed.
  - A collapsed group's servers are also left out of the Cluster Dashboard
    (`ClusterDataView.tsx`) and both of the Web Dashboard's own aggregate views (its
    "Dashboard" card-grid tab and its own "Cluster Dashboard" tab) - not just visually
    minimized on the Manager's own Dashboard. The server itself stays fully manageable
    everywhere else (still listed in every Web Dashboard server picker, still reachable by
    its own direct Console/Settings/etc.) - only the aggregate summary views skip it. The Web
    Dashboard's `/api/servers` response carries a new `groupCollapsed` boolean per server for
    this, computed server-side from the same `AppSettings.collapsedGroups`.

- **New Manager-wide setting: "Show the server's own console/debug window"** (Settings →
  General → Startup & Safety, `AppSettings.showServerConsoleWindow`, default on - unchanged
  behavior). Both games allocate their own small-font console window the moment their exe is
  spawned (ARK: Survival Evolved's through the `.bat`/cmd.exe it launches via, ARK: Survival
  Ascended's directly) - there's no launch flag that suppresses it and no way to resize its
  font from the Manager. Unchecking this passes Node's own `windowsHide` to both spawn calls
  instead, which stops Windows from ever creating the window - the server itself, and its own
  log file, are unaffected either way. No-op on non-Windows.

- **ARK: Survival Evolved: Backup tab's Player Profile Backups section removed.** Its own
  `.profilebak`/log format for this isn't verified the way ARK: Survival Ascended's is (see
  `GameDefinition.supportsPlayerProfileBackups`, already `false` for it) - the desktop
  Backups tab now actually hides the whole section (checkbox, backups-to-keep field, and the
  browse/restore panel) instead of showing controls for a feature that was already a silent
  no-op. The Web Dashboard's own Backup tab still shows it unconditionally for every game -
  not yet fixed there (same class of gap as the "Not yet done" note above).

- **ARK: Survival Evolved: update checking turned off.** Its dedicated server is no longer
  developed - SteamCMD's public branch build id for it essentially never changes, so
  comparing against it had nothing useful to say and could only ever show a permanently-stale
  "No new update available." New `GameDefinition.supportsUpdateCheck` flag (`false` for it,
  `true` for ARK: Survival Ascended) gates both the background poller (`updateCheck.ts`, was
  polling SteamCMD for every SteamCMD-based game every 30 minutes regardless of whether
  anything displayed it) and the Analytics tab's "New update"/"A server update is available"
  panel. The SteamCMD **install/update** button itself (Dashboard card, Update Log tab) is
  untouched - installing/updating ARK: Survival Evolved's server files still works exactly as
  before, this only turns off the separate "is a newer build available" check.

- **ARK: Survival Evolved: game version display made more robust, cause of the original
  report not conclusively found.** A real report said the Analytics/Dashboard version display
  still wasn't updating for ARK: Survival Evolved servers, even after the earlier fix that
  confirmed the version-line regex itself matches a real log line
  (`serverVersion.test.ts`). Static review of the whole pipeline (log path, the edge-triggered
  cache in `serverVersionWatcher.ts`, the 'running'-transition/fallback timing, the .bat/pid
  hand-off code) found nothing ARK: Survival Evolved-specific - every step is shared,
  game-agnostic code already exercised by ARK: Survival Ascended working correctly. One real
  gap was found and fixed regardless: `IPC.serverGetGameVersion` only ever returned whatever
  `serverVersionWatcher.ts`'s edge-triggered state tracking had already cached, so if that
  tracking ever missed the right transition for any reason, the polling both the Dashboard and
  Analytics tab already do would keep re-reading the same stale (possibly still-null) cache
  forever rather than ever re-checking the log file directly. It now falls back to a live log
  read whenever nothing's cached yet, caching whatever it finds - this can only help, but
  wasn't confirmed to be *the* cause, since the mechanism this replaces looked structurally
  sound on inspection. If the version still doesn't appear after this, that points at
  something below this app's own version-reading code (e.g. the log file's actual on-disk
  path/content on a real installation) rather than the cache/polling layer.

- **Root cause found for both the empty console and the missing version: `-log` is required
  after all.** A previous pass here considered and rejected adding `-log` back to ARK:
  Survival Evolved's launch args, on the strength of a test that encoded an earlier
  real-hardware confirmation that it was deliberately left out. A real report has since
  confirmed the opposite: without it, `ShooterGame.log` - the file the Manager's Console/
  Cluster Console/Web Dashboard console and version detection all read - never fills in the
  way the Manager needs, even though `-servergamelog` is also passed. `-servergamelog` turns
  out to control a separate, dated tribe-log feature (`ServerGame.<date>.txt`), not the
  engine's own log; `-log` is what actually was missing. `buildLaunchArgs` now pushes both for
  ARK: Survival Evolved (`-servergamelog` for the tribe logs, `-log` right after it for the
  engine log), and `launchArgs.test.ts` is updated to match. The earlier "-log deliberately
  omitted" confirmation was apparently about getting the server to *launch* successfully, not
  about whether the file the Manager reads actually fills in - two different things that
  happened to get conflated.

- **ARK: Survival Evolved: Zombie Detection now also watches for a frozen world while
  running, not just a stuck startup.** A real report described a server that stayed "running"
  (process alive, sometimes still RCON-reachable) with its actual game loop frozen - the
  existing Zombie Detection (`zombieDetection.ts`) only ever watched the `starting` phase, so
  it had nothing to say about that. It now also arms, ARK: Survival Evolved only, the moment a
  profile reaches `running`: every minute it checks whether `ShooterGame.log` has grown at all
  since the last check; if it stays exactly the same size for a full
  `zombieDetectionTimeoutMinutes`, that's treated as a frozen world tick and killed the same
  way (optionally auto-restarted), reusing the same settings already on the Server Management
  tab. A momentarily-unreadable log (a stat error, a rotation race) is never itself treated as
  zombie evidence - only a confirmed *unchanged* size counts, so a transient glitch can't cause
  a false-positive kill. ARK: Survival Ascended doesn't get this second watch - its own
  startup-stuck check already covers the zombie scenario actually reported for it, and this
  would otherwise be an unverified, unrequested behavior change. (The specific example log line
  a report pointed at - a seasonal "Set `<event>` event location: ..." line written once during
  world init - wasn't used as the literal signal: it's not confirmed to repeat during normal
  running, and every seasonal event's location line apparently gets logged at boot regardless
  of the calendar, so hardcoding one particular event's text would be both fragile and
  unnecessary. Watching whether the log is growing *at all* is the same idea, generalized
  safely to whatever a real server actually logs on its own.)

- **ARK: Survival Evolved: join/leave events now show up in the Console/Cluster Console/Web
  Dashboard.** With `-log` now filling in `ShooterGame.log` for it, a real excerpt showed its
  join/leave wording is simply different from ARK: Survival Ascended's, not just delayed -
  `logEvents.ts`'s `JOIN_LEFT_RE` requires a `[UniqueNetId: ... Platform: ...]` bracket ARK:
  Survival Evolved never writes at all. It instead logs `<Player> joined/left this ARK!
  (<SteamID64>)` with an optional trailing `(TribeID: <id>)`, on a plain line with no bracket
  - now matched by a new `JOIN_LEFT_ALT_RE`, tried whenever the first one doesn't match. The
  same real excerpt also showed ARK: Survival Evolved writing a second, earlier line for the
  very same join/leave (inner-timestamped, no Steam ID, no bracket either) - deliberately left
  unmatched by requiring the Steam ID group, the same "avoid a duplicate" pattern already used
  for "Frozen by ID" just below it, rather than emitting the same join/leave twice. Kill events
  needed no change - `rest.includes('was killed by')` already isn't wording-specific enough to
  care which game wrote it, confirmed against a real (RichColor-wrapped, tribe/day-prefixed)
  ARK: Survival Evolved kill line and its plainer global-log echo, both already categorized
  correctly (if the tribe-log-styled one is displayed with a bit of leftover
  `Tribe X, ID Y: Day N, HH:MM:SS:` prefix and a stray trailing `)` from the engine's own
  formatting - cosmetic, not a bug, and not new to ARK: Survival Evolved).

- **Fixed a real bug, unrelated to ARK: Survival Evolved specifically: RCON could flood the
  console with uncaught "read ECONNRESET" exceptions.** A real report showed dozens of these
  in the Manager's own terminal/command-prompt window (not crashing it, but clearly a bug) -
  traced to a genuine gap in the `rcon-client` package. `sendRconCommand` (`rcon.ts`) already
  attached a no-op `'error'` listener to guard against exactly this, but only *after*
  `Rcon.connect()` resolved - and `connect()` itself authenticates over the socket as its last
  step. A connection reset during that authentication exchange fires the socket's `'error'`
  event - which `rcon-client` re-emits on the `Rcon` instance's own `EventEmitter` - before
  `connect()`'s promise (and therefore our listener) exists yet. With no listener at that
  moment, Node's default behavior for an unhandled `'error'` event is to throw, once per RCON
  call that happens to land in that window - and RCON gets polled every few seconds. Fixed by
  constructing the `Rcon` instance directly (`new Rcon(config)`) and attaching the listener
  *before* calling `.connect()`, rather than using the `Rcon.connect(config)` static helper -
  closes the window entirely rather than narrowing it. Reproduced and locked in with a real
  test (`tests/rcon.test.ts`): a fake TCP server that accepts the connection and resets it the
  moment it receives the auth packet, confirmed to genuinely throw an uncaught `ECONNRESET`
  against the pre-fix code and pass cleanly against the fix.

- **Fixed a much bigger bug in the same family: a Windows disk-write failure could break
  actual server actions, not just spam the console.** A real report showed a raw libuv
  "UNKNOWN: unknown error, write" (a generic Windows I/O failure - a full disk, a locked
  file, antivirus, a dropped network drive, ...) thrown from `logManagerEvent` during a Stop,
  and separately from `recordStatSample` inside `monitor.ts`'s `tick()` - and, worse, a server
  stuck showing as running in the UI long after it had actually stopped, with every further
  action against it (Kill included) failing the same way. Every one of these best-effort,
  secondary persistence calls previously let a disk-level failure throw straight out:
  - `logManagerEvent` (`managerLog.ts`) is called directly from `doStartServer`/
    `doStopServer`/`doKillServer`/... - a throw there turned an action that had *already
    succeeded* into a reported failure, since in every one of those the real work (actually
    stopping/killing the process) runs before the logging call.
  - `recordStatSample` (`statsHistory.ts`) runs inside `monitor.ts`'s `tick()`, called as
    `void tick(profile)` - not awaited or caught by anything - so a throw there became an
    unhandled promise rejection, once per running stats-enabled profile, every ~5 seconds.
  - `appendEventsToArchive` (`clusterLogArchive.ts`) runs as a listener on the shared
    `serverEvents` `EventEmitter` (`registerClusterLogArchiveWatch`) - and a listener that
    throws synchronously aborts that same `emit()` call for every other listener registered
    after it, on that exact status change, for every running profile roughly every 2 seconds.
  - **The likely actual explanation for the stuck-as-running server**: `serverProcess.ts`'s
    `finalizeStopped` (and `startServer`'s own success path) call `setRunningPid`/
    `setRunningStartedAt` (`store.ts`, persisted via `electron-store`) *immediately before*
    `emitStatus()` - the one call that actually updates the renderer's view of a server's
    state. If either persist call threw, `emitStatus()` right after it never ran at all,
    leaving the UI showing the previous state indefinitely even though the Manager's own
    internal tracking (`running.delete(profileId)`, run just before) had already moved on.
  
  All four now catch and log to `console.error` instead of throwing - persisting a log entry,
  a stats sample, an archived event, or the running-pid bookkeeping used only to re-adopt a
  process after a Manager restart, is allowed to fail without taking the actual action (or
  another module's unrelated `serverEvents` listener) down with it. Each fix has its own test
  simulating the write failure directly (`vi.spyOn` on `fs.appendFileSync`/`writeFileSync` or,
  for `store.ts`, `Store.prototype.set`) and asserting the surrounding call no longer throws -
  including, for the archive listener specifically, a test proving a later-registered
  `serverEvents` listener still fires when an earlier one's write fails, the exact class of
  bug this was.

- **Follow-up: the same class of bug existed on the read side too, and a real report showed
  it - fixed the same way.** Once writes stopped throwing, reads started showing up in the
  same report instead: `readAllSamples` (`statsHistory.ts`, behind the `stats-history:get`
  IPC handler the Analytics tab/Cluster Dashboard poll every 5s), `readManagerLog`
  (`managerLog.ts`, the Manager Log view's own read), and `readFileTail` (`logEvents.ts`,
  shared by the desktop Console tab, the Web Dashboard's console, and the Cluster Data group
  console) all called `fs.readFileSync`/`fs.readSync` unguarded. All three now catch and log
  to `console.error`, returning an empty result (`[]`/`''`) instead of throwing back out.
  `readAllSamples` needed one extra bit of care its write-side counterpart didn't: on a read
  failure it deliberately does *not* cache the empty result the way it does for "the file
  genuinely doesn't exist yet" - caching `[]` there would make every future read look
  identical to "no history" forever, even once the disk recovers, and would make
  `recordStatSample`'s own cache-append logic start accumulating into a wrongly-reset empty
  cache in the meantime. A test locks this in: a failed read returns `[]` once, but a real
  sample recorded before the failure is still there on the very next successful read.

  **This pattern - the exact same generic Windows I/O error (`UNKNOWN`, `errno: -4094`) now
  hitting reads *and* writes, across the Manager's own data directory, repeatedly rather than
  as a one-off - stopped looking like something more exception-handling can fix.** The same
  report also showed `restoreBackup` (`backup.ts`) failing with the identical error code from
  inside a third-party zip-extraction call, writing into the *server's own* install directory
  - a completely different location from the Manager's own data folder that every fix above
  touches. A restore that can't write its extracted files is a genuine failure with nothing to
  gracefully degrade to (unlike a log line or a stats sample, there's no correct "pretend it
  worked" for a restore), so that one is already surfacing correctly as a reported error
  rather than crashing anything - it's included here only as evidence of how broad this is.
  Two unrelated directories on the same machine, both reads and writes, recurring rather than
  transient: this points at something below the app entirely (the disk itself full or
  failing, a sync client like OneDrive holding files open, antivirus actively blocking I/O to
  these paths, or a dropped network drive) rather than a specific code path still left to
  harden.

- **Second follow-up, and the actual resolution.** Disk space was fine (checked, plenty free
  on every drive) and CrystalDiskInfo showed the physical drive itself (an internal NVMe,
  ruling out the "flaky external/virtual disk" theory) as healthy - yet the exact same error
  kept recurring, next caught crashing `'server:start'` itself: `readIniFile` (`config.ts`,
  used by `readAdminPassword`, called from `buildLaunchArgs` on every single start) threw
  straight out, meaning a server couldn't even be started while this was happening. Also
  hardened the same way while already in the area, all on the same "a real report showed
  this recurring" evidence: `getInstalledBuildId`/`checkInstallUpToDate`/`readUpdateLog`/
  `readNewContentLog`/`clearStuckManifest` (`steamcmd.ts`, the Dashboard's Install-vs-Update
  state and the Update Log tab), `readMapDefinitionsFile` (`jsonListFile.ts`, maps.json/
  customMaps.json - including the write that creates the file fresh on its very first read),
  and `upsertIniKey`/`upsertIniRepeatedKey` (`gameConfigWrite.ts`, ARK: Survival Evolved's
  mod-save writes) - the last of which needed the same care as `readAllSamples` above, for
  an even higher-stakes reason: falling back to `''` on a read failure the way a genuinely
  missing file is handled would make the subsequent write think there was nothing in the
  file to begin with, and overwrite the user's real `GameUserSettings.ini`/`Game.ini`
  content with just the one key being upserted - actual data loss, not just a missed update.
  It now aborts the write entirely (leaving the file untouched) when the read that's
  supposed to feed it fails, locked in by a test that writes real content, fails the read,
  and asserts the file is still exactly what it was before.

  It turned out to be exactly the kind of thing this pattern pointed at: **a reboot of the
  machine resolved it.** Not a disk fault, not something in the app - a stuck driver/OS-level
  I/O state that a restart cleared. Every fix in both of these sessions stands regardless -
  they're general resilience against a real, reproducible class of failure (a disk-level
  read/write erroring out transiently), not specific to this one report's eventual cause, and
  cost nothing when nothing's wrong.

- **Minecraft follow-up 4: dashboard card polish, a Backup tab, a persistent+colorized console.**
  - **Card header gets the MC icon** (`assets/games/minecraft.png`, already bundled for the
    sidebar switch) next to the server name, same placement as ARK's own `server-card-game-icon`.
    **Address moved back inside the dark info panel** as its own full-width row (`.server-card-info-address`,
    `grid-column: 1 / -1`) alongside CPU/Players/Type/RAM instead of sitting in a separate div
    below it, and **Players is now always shown** (a `-` placeholder when the status doesn't
    have a player list yet) instead of being hidden entirely until the first status tick with
    a non-empty list.
  - **New Backup tab**, modeled on ARK's own Backups tab but backing up the *world* instead of
    a map's SavedArks folder: two new `MinecraftProfile` fields (`backupDir`, `maxBackups`,
    plus `backupSchedule`/`backupScheduleEnabled` for the same optional cron-driven automatic
    backups ARK has - all four backfilled in `migrateMinecraftProfile` for any profile saved
    before this pass). `minecraftBackup.ts`'s `worldDirs()` reads `level-name` from
    server.properties (defaulting to `world`, same as the vanilla server itself) and backs up
    whichever of `<level-name>`/`<level-name>_nether`/`<level-name>_the_end` actually exist -
    every server type (vanilla/Paper/Spigot/Forge/Fabric) uses this same per-dimension folder
    convention. While the server's running, `createMinecraftBackup` sends `save-off` then
    `save-all flush` (stdin first, RCON fallback - `sendSaveCommand`) and waits a short settle
    before zipping, then re-enables autosave with `save-on` - best-effort rather than
    cancel-on-failure like ARK's own SaveGame/RCON gate, since Minecraft's autosave already
    runs on its own every few minutes regardless, so the worst case here is a backup that's a
    few seconds staler than requested. `minecraftBackupSchedule.ts` mirrors ARK's own
    `schedule.ts` self-arming-setTimeout mechanism (armed only while the server is running,
    re-armed on every status transition into 'running'). New IPC namespace
    (`window.api.minecraft.backup.*`, `ipc/minecraftBackup.ts`) and renderer tab
    (`MinecraftServerDetail/BackupsTab.tsx` + `BackupLogPanel.tsx`), placed before Server
    Management in the tab list.
  - **The console backlog now survives a Manager restart** (and the Minecraft server's own
    restarts too) instead of resetting to empty every time - previously an in-memory ring
    buffer (`consoleBacklogs` Map in `minecraftProcess.ts`) that was explicitly cleared on
    every `startServer()` call and lost outright on a Manager restart. Replaced with
    `minecraftConsoleArchive.ts`, a JSON-Lines file per profile under `getDataDir()` with the
    same size-capped rolling-window trim as ARK's own `clusterLogArchive.ts` (bounded
    read+rewrite only on the rare append that actually crosses the cap, not on every line).
    `startServer()` no longer clears anything on a fresh start, so the archive spans multiple
    server sessions, not just the Manager's own uptime.
  - **Console lines are now color-coded**, matching the screenshots that drove this request:
    a small `classifyConsoleLine` helper in `ConsoleTab.tsx` checks (in priority order, since
    several of these are still logged at plain INFO level) a graceful shutdown starting
    ("Stopping the server") and `/ERROR]`/`/WARN]` for red/red/orange, the "Done (...)! For
    help" ready line for green, "joined the game" for cyan, and "left the game"/"lost
    connection"/"disconnected" for orange - everything else stays the default color. Purely
    cosmetic CSS classes (`.mc-console-line--*`), no change to what's actually stored/sent.

- **Minecraft follow-up 5: card info order, bulk Server Controls, Global Performance, console
  controls repositioned.**
  - **Dashboard card's info panel reordered** to CPU/RAM then Players/Type, with Address still
    its own full-width row underneath - just a JSX reorder (`MinecraftDashboard.tsx`), the grid
    itself is unchanged.
  - **New "Server Controls" bulk-action section** above the server grid, mirroring ARK's own
    (`Dashboard.tsx`) but with only Start All/Restart All/Stop All - no Update All or
    Stop+Update+Restart All, since Minecraft has no SteamCMD-equivalent update step. There's no
    single-profile restart IPC for Minecraft the way ARK has `window.api.server.restart`, so
    Restart All is a plain stop-then-start per running profile, the same sequencing
    `minecraftScheduledActions.ts`'s own scheduled restart already uses.
  - **New "Global Performance" sidebar block**, same `official-status-panel`/
    `group-console-cluster-stats` markup and aggregation (servers running/total, total
    players, total CPU%, total RAM) as ARK's Dashboard, computed across every visible
    Minecraft profile's live status.
  - **Console tab's Chat mode/Auto-scroll checkboxes moved below the feed, right-aligned**
    (new `.mc-console-controls` modifier on the existing `.group-console-filters` row) instead
    of sitting above it - matches the user's own screenshot of the desired layout.
  - **Removed the Console tab's re-adopted-session description paragraph** ("This server was
    already running before the Manager (re)started...") - same ongoing trend of trimming
    explanatory text the user doesn't want cluttering the UI.

- **Fixed: restarting several ARK servers close together left only 1-2 of them actually
  coming back up.** A real report: manually restarting multiple servers resulted in most of
  them just never starting, with no error shown. Investigated and ruled out: port conflicts
  between profiles (confirmed unique), a shared/global RCON connection (each call opens its
  own `Rcon` instance), and a RAM ceiling (the reporting machine had 128GB). The remaining,
  consistent explanation: ARK's own world-loading is heavy enough - much of it
  single-threaded - that several servers spawning in the same instant can starve each other
  out for CPU badly enough that some never finish loading at all.
  - **`serverProcess.ts`'s `startServer` now goes through a global (not per-profile) spawn
    queue** (`reserveSpawnSlot`/`nextSpawnSlotAt`) that enforces at least
    `AppSettings.serverAutoStartStaggerSeconds` between any two ARK servers' actual OS-level
    process spawn - covering every path that can start several close together: a manual
    Start/Restart click, the Dashboard's bulk Start All/Restart All, a scheduled restart, and
    a crash-watch/zombie-detection auto-restart - not just `startOnManagerLaunch` (which
    already staggered itself via `autoStart.ts`, and keeps doing so unchanged; the two don't
    double up in practice since autoStart's own pacing already satisfies this queue by the
    time each of its calls reaches `startServer`). The first start in a batch is never
    delayed - only one requested while another is still within the stagger window waits.
  - A still-queued (not yet actually spawned) start is tracked in the same `running` map as a
    live one, with a new `cancelQueuedSpawn` escape hatch - so a Stop/Kill requested during
    the wait cancels it outright instead of racing the queued spawn and starting it anyway
    right after being told to stop. `getStatus()` reports `starting` consistently through the
    wait too, instead of `stopped` just because nothing had spawned yet.
  - Reused the existing `serverAutoStartStaggerSeconds` setting (renamed in the Settings UI to
    "Minimum delay between servers starting") rather than adding a second one, since it's the
    same underlying concern - Minecraft is unaffected (its own, separate `minecraftProcess.ts`
    was never part of this).
  - New `tests/serverSpawnStagger.test.ts` covers the queue directly: a lone start is never
    delayed, a second one requested immediately after waits out the full stagger, a third
    stacks behind the second (not the first), a well-spaced start incurs no wait, and
    stopping/killing a still-queued start cancels it without ever spawning. Also patched 5
    existing test files (`serverProcessBatchLaunch`, `startServerSpawnOptions`,
    `stopServerPhased`, `findListeningPid`, `unexpectedExit`) to reset the new queue's module
    state between tests - its 10s default stagger would otherwise leak from one `it()` into
    the next real-timer test in the same file and silently defer a spawn they expected
    synchronously.

- **Minecraft Dashboard groups**, matching ARK's own Dashboard group system - `MinecraftProfile.group`
  (set via the Start Settings tab's "Dashboard group" field) already existed but the Minecraft
  Dashboard never actually grouped anything by it. Same markup/behavior as ARK: collapsible
  `<details className="server-group">` sections, a drag handle on each group's summary to
  reorder groups, and collapse state that persists across restarts. Kept in two new,
  Minecraft-only settings (`minecraftGroupOrder`/`minecraftCollapsedGroups`) rather than
  sharing ARK's `groupOrder`/`collapsedGroups`, since an ARK group and a Minecraft group
  happening to share a name shouldn't share display order or collapse state. No new CSS -
  `.server-group`/`.drag-handle`/`.hidden-servers` were already generic, not ARK-specific.

- **Minecraft mod/plugin browsing and installation, v1 (Modrinth only) - new Mods tab.**
  CurseForge is a deliberate follow-up, not implemented here: it needs its own API key
  (register as a developer at console.curseforge.com) and its own client module, while
  Modrinth's v2 API needs no key at all. Everything below is organized so adding CurseForge
  later means a second client module plus a branch in `minecraftMods.ts`, not touching
  `shared/minecraftMods.ts`'s already source-agnostic shapes.
  - **New `MinecraftProfile.minecraftVersion` field** (Start Settings) - a real, previously
    entirely missing prerequisite: nothing else in this app tracks a server's actual Minecraft
    game version, but Modrinth needs it to filter compatible mod/plugin versions. Free text
    (e.g. "1.20.1"), no auto-detection in this pass; the Mods tab shows a clear empty-state
    message asking for it instead of guessing wrong.
  - **`src/main/lib/modrinthClient.ts`**, a thin wrapper around Modrinth's public v2 REST API
    (confirmed directly against Modrinth's own open-source backend models, not just third-party
    docs, since the v2/v3 split made some of the publicly written docs ambiguous). Loader to
    Modrinth "category" facet mapping: Fabric/Forge get their own single category; Paper and
    Spigot share one OR-ed group (`paper`/`spigot`/`bukkit`) since plugins are broadly
    cross-compatible across those three and splitting them would just hide results that work
    fine. Vanilla/unknown get no loader facet at all (and never reach this client - the Mods
    tab and `minecraftMods.ts` both gate on `supportsMinecraftMods` first).
  - **Excludes client-only content, as requested** - `server_side:unsupported` is filtered out
    directly in the search facets (`server_side: required` or `optional` only), not as a
    post-filter, so a mod that does nothing on a dedicated server never shows up as installable
    in the first place.
  - **Dependency resolution, a real first pass, not just planned** -
    `resolveModInstallPlan` in `minecraftMods.ts` walks a version's own `dependencies` and
    recursively resolves every `required` one to an installable version (by exact `version_id`
    when pinned, otherwise the latest compatible version of that `project_id`), skipping
    anything already installed or already queued in the same run (dedup, with a depth cap as a
    cycle safety net - confirmed against a diamond-dependency graph and a direct A-depends-on-B-
    depends-on-A cycle in tests). `embedded` dependencies are skipped outright (already bundled
    in the parent jar); `optional` ones are never auto-installed, just surfaced in the result so
    the Mods tab can tell the user what they could add by hand; `incompatible` ones are only
    reported when the conflicting project is already installed - a warning, not a block.
  - **Install/remove/enable-disable**: downloads the version's primary file (`fetch` +
    `arrayBuffer` + `writeFileSync`, same pattern as `steamcmdInstaller.ts`'s own download),
    verified against Modrinth's own published sha512/sha1 hash before being kept - a corrupted
    download is discarded rather than left as a jar the server might fail to load. Writes to
    `mods/` (Forge/Fabric) or `plugins/` (Paper/Spigot) under the server's install directory.
    Disabling renames the file to add a `.disabled` suffix rather than deleting it (every
    loader only loads `.jar` files from that folder), so re-enabling needs no re-download, and
    updating an already-disabled mod preserves that - it doesn't silently come back enabled.
  - **No version picker in this pass** - Install/Update always resolve to the latest
    compatible version, the same simplification ARK's own mod system already makes (an id,
    no picker there either). A real gap to revisit, not an oversight.
  - New `tests/modrinthClient.test.ts` (facet-building), `tests/minecraftModInstallPlan.test.ts`
    (the dependency-walk algorithm itself, including the diamond-graph and cycle cases, with no
    network/fs touched at all), and `tests/minecraftMods.test.ts` (install/remove/enable-disable/
    update-check against a real temp directory, with Modrinth's own HTTP calls mocked).

- **Recognizes mods/plugins already sitting in the folder, not just ones installed through the
  Mods tab.** `profile.installedMods` used to be the only source of truth, which meant a jar
  dropped in by hand - or installed before this feature existed - simply wasn't tracked. Fixed
  by hashing every untracked `.jar`/`.jar.disabled` file in the mods/plugins folder (sha1) and
  batch-looking the hashes up against Modrinth's `/version_files` endpoint - the same
  identification mechanism Modrinth's own official launcher uses. Matches are adopted straight
  into `profile.installedMods`; anything that doesn't match (CurseForge-sourced, hand-built, or
  genuinely not on Modrinth) is left alone and reported as an `unidentifiedCount` instead of
  silently doing nothing.
  - `getModrinthVersionsFromHashes` in `modrinthClient.ts` wraps the batched `POST
    /v2/version_files` call (`{algorithm, hashes}` -> `Record<hash, Version>`).
    `scanForInstalledMods` in `minecraftMods.ts` does the scanning/hashing/adopting; a new
    `requireLoaderSupportsMods` guard replaces the stricter `requireModsSupported` for this one
    operation specifically, since identifying a file by hash doesn't need
    `profile.minecraftVersion` the way picking a *compatible* version for search/install does -
    so scanning now works even before that field is filled in.
  - Runs automatically whenever the Mods tab opens for a profile, plus an explicit "Rescan
    folder" button for files added while the tab is already open. The Browse Modrinth section
    still asks for a Minecraft version (search needs it to filter compatible versions), but the
    Installed section and its Rescan button no longer wait on it.
  - New `tests/minecraftModScan.test.ts`: hash-match adoption, skip-already-tracked,
    unidentified-count reporting (profile left untouched), `.disabled`-suffix enabled-state
    handling, no API call when nothing is untracked, and works with no `minecraftVersion` set.

- **Fix: scanning a folder with several untracked mods could trip Modrinth's rate limit
  (HTTP 429), reported live by a user with a sizeable mods folder.** Two causes, both fixed:
  - Scanning used to fetch each adopted mod's project info one request at a time
    (`getModrinthProject` in a loop) - a folder with a dozen unrecognized mods meant a dozen
    sequential requests on top of the batched hash lookup. Replaced with a new
    `getModrinthProjects(ids)` in `modrinthClient.ts` (`GET /v2/projects?ids=[...]`, Modrinth's
    own batch counterpart to `/project/{id}`), so `scanForInstalledMods` now costs exactly two
    Modrinth requests total regardless of how many mods it finds: one for the hashes, one for
    every matched project's info (deduplicated, since several versions can belong to the same
    project).
  - There was no recovery from a 429 at all - any transient rate-limit hit failed the whole
    scan outright. `modrinthFetch` (and the raw `/version_files` POST) now retry on 429, waiting
    out the response's `Retry-After` header when present or an exponential backoff otherwise, up
    to 3 retries before actually giving up - self-heals from Modrinth's normal per-minute
    throttling instead of surfacing it as an error.
  - New tests in `tests/modrinthClient.test.ts` (waits out `Retry-After` and retries
    successfully; gives up and throws after exhausting retries) and
    `tests/minecraftModScan.test.ts` (batches the project lookup into one deduplicated call for
    several matched mods).

- **Fix: no visible way to get to the one thing blocking "Browse Modrinth" (install search).**
  A user reported "I don't see a way to add mods" - turned out their server's Minecraft version
  just wasn't set yet, so the Mods tab correctly showed the explanatory message
  ("Set this server's Minecraft version in Start Settings...") but gave no way to act on it
  without manually switching tabs and finding the right field. Added a "Go to Start Settings"
  button under that message (and under the similar "Set Server type to..." message), which jumps
  straight to the Start Settings tab - `MinecraftServerDetail/index.tsx` now passes
  `onGoToStartSettings` down to `ModsTab` instead of just rendering it blind.

- **Four more fixes/additions after a live screenshot (256 installed mods) surfaced them:**
  - **Mod icons weren't loading (broken-image placeholders everywhere).** The renderer's CSP
    (`src/renderer/index.html`) was `default-src 'self'` with no `img-src` at all, which blocks
    `<img>` loads too - Modrinth's icon CDN (`cdn.modrinth.com`) was silently refused by the
    browser, not by anything in this app's own code. Added
    `img-src 'self' data: https://cdn.modrinth.com`. Also added an `onError` handler on both mod
    icon `<img>` tags so a URL that fails to load (dead link, network hiccup) just hides itself
    instead of showing a broken-image icon regardless.
  - **Mods the scan can't identify now still show up in the table, instead of only being
    counted.** `MinecraftModSource` gained a third value, `'unknown'` - not a future source like
    CurseForge, but what `scanForInstalledMods` now assigns to an untracked file whose hash
    doesn't match anything Modrinth knows about. It's still added to `profile.installedMods`
    (synthetic `projectId: "local:<fileName>"`, title falls back to the file name, empty
    version fields), so it still shows up, and because remove/enable-disable already worked
    generically off `projectId`/`fileName`, those just work for it too with no special-casing.
    The Status column shows "Unidentified" (muted, with a tooltip explaining why) instead of
    "Up to date". `checkMinecraftModUpdates` skips `source: 'unknown'` entries (no real Modrinth
    id to check) rather than firing a doomed `/project/local:x.jar/version` request for each
    one. `MinecraftModScanResult.unidentifiedCount` is gone - the same information now comes
    from filtering `adopted` by `source`.
  - **Display bug: Version/Status/Actions columns were stretched out with a dead gap before the
    buttons.** The `mc-mods-table`s had no explicit column widths, so the browser's auto table
    layout gave the empty-header actions column (and the short Version/Status columns) far more
    room than their content needed, pushing the Enable/Disable/Remove buttons away from the row
    they belonged to. New `.mc-mods-col-narrow` class (`width: 1%; white-space: nowrap`) on
    those columns makes them hug their content, so Name/Description (the one column that should
    be wide) absorbs the leftover space instead.
  - **"Open mods folder" / "Open server folder" buttons** - jumping to `mods/`/`plugins/` (or
    the server's install directory) used to mean finding the path by hand. New
    `openMinecraftModsFolder` (`minecraftMods.ts`, creates the folder first if it doesn't exist
    yet) and `openMinecraftServerRootFolder` (`minecraftBackup.ts`, next to the existing
    `openMinecraftBackupFolder`) both just wrap `shell.openPath`, same pattern as every other
    "open folder" button in this app. Buttons added to the Mods tab's Installed section and the
    top of Server Settings, respectively.
  - New tests: `tests/minecraftModScan.test.ts` (unidentified files adopted as `source:
    'unknown'`, mixed identified/unidentified scan, `openMinecraftModsFolder`),
    `tests/minecraftMods.test.ts` (`checkMinecraftModUpdates` skips `'unknown'` entries), and
    new `tests/minecraftServerFolder.test.ts` (`openMinecraftServerRootFolder`).

- **Fix (follow-up): the column-width fix above wasn't enough on its own - Disable/Remove
  (and Update, when present) were still stacking vertically instead of sitting side by side,
  inflating every row's height.** `mc-mods-col-narrow`'s `width: 1%` only works if the column's
  *content* can report an honest minimum width - but the actions cell's `.backup-management-
  actions` has `flex-wrap: wrap`, and a wrapping flex container's min-content width is just its
  single largest item, not the combined width of everything in it (wrapping means it's always
  "allowed" to fall back to one item per line). So the column collapsed to fit one button, and
  the rest wrapped onto their own lines underneath. Added `.mc-mods-table .backup-management-
  actions { flex-wrap: nowrap }` to force one line - three short buttons always fit, and that
  was the whole point of giving the column minimal width in the first place.

- **CurseForge integration, v1 (search, install, update) - the planned follow-up from the
  original Modrinth-only Mods tab is now real.** Gated behind a user-provided API key
  (`AppSettings.curseforgeApiKey`) since CurseForge's Core API requires one, unlike Modrinth's.
  **Get a free key at `console.curseforge.com`**: sign in with a CurseForge/Overwolf account,
  open **API Keys** in the left sidebar, click **Generate new API key**, give it any name, and
  agree to the non-commercial terms - the key shown there goes straight into Settings → General
  → Integrations. Leaving it empty skips CurseForge entirely (not an error) - Modrinth search
  keeps working exactly as before.
  - **`src/main/lib/curseforgeClient.ts`**, a thin wrapper around the CurseForge Core API
    (`api.curseforge.com/v1`), mirroring modrinthClient.ts's own shape (raw CurseForge shapes
    in, this app's own normalized shapes out - handled in minecraftMods.ts, not here). Minecraft
    is game id `432`; Forge/Fabric content is CurseForge "class" `6` (Mods), Paper/Spigot
    content is class `4471` (Bukkit Plugins) - there's no single "mod" class the way Modrinth's
    v2 API flattens it. `modLoaderType` (1 Forge, 4 Fabric) filters search/files for those two;
    Paper/Spigot plugins aren't loader-filtered on CurseForge at all, so it's omitted for them.
    `getCurseForgeModFiles` sorts by `fileDate` itself (CurseForge doesn't guarantee an order)
    so `[0]` is reliably "the latest compatible file" - same "no version picker" simplification
    used everywhere else in this app's mod system.
  - **Search merges both sources** - `searchMinecraftMods` always searches Modrinth, and also
    CurseForge once a key is set, combining and sorting the results by downloads (each tagged
    with its own `source` so the UI can label it). A CurseForge mod with
    `allowModDistribution: false` (the author opted out of third-party downloads) is filtered
    out of results entirely - this app has no file to offer for it anyway. A CurseForge search
    failure (bad key, network hiccup) is logged and dropped rather than failing the whole
    search - Modrinth's own results still come back.
  - **Install/update dependency resolution, same shape as Modrinth's, adapted to CurseForge's
    own model** - `resolveCurseForgeInstallPlan` (mirrors `resolveModInstallPlan`) walks a
    file's `dependencies` (`{modId, relationType}` pairs, not Modrinth's richer
    `{project_id, version_id, dependency_type}`): relationType `3` (RequiredDependency) is
    walked and installed (always the dependency's own latest compatible file - there's no
    per-version pin like Modrinth's `version_id`), `2` (Optional) is surfaced not installed,
    `5` (Incompatible) is a warning only if already installed, and `1`/`4`/`6` (EmbeddedLibrary/
    Tool/Include) are skipped outright. Same depth cap, same dedup-by-already-queued-or-
    installed reasoning, confirmed against the same diamond-graph and cycle test cases as the
    Modrinth version.
  - **`installMinecraftMod`/`updateMinecraftMod` now take a `source` parameter** (IPC/preload/
    `ModsTab.tsx` all updated to pass it through - a search result or an installed entry always
    has its own `source` handy, so this never needs guessing). The original Modrinth install
    function was renamed to `installModrinthMod` (no longer exported) and `installMinecraftMod`
    is now a small dispatcher by source; `'unknown'` throws (there's nothing to install from an
    entry with no real backing id).
  - **Downloads verified against CurseForge's own sha1 hash when published**, same discard-on-
    mismatch behavior as Modrinth's own download path. A file with no `downloadUrl` at all
    (author disabled distribution) fails with a clear message pointing at downloading it from
    CurseForge directly and using Rescan folder instead - not silently skipped.
  - **`checkMinecraftModUpdates` branches per installed entry's `source`** - Modrinth entries
    check Modrinth, CurseForge entries check CurseForge (and are skipped, not failed, if the API
    key was cleared since they were installed), `'unknown'` entries are skipped as before.
  - **Not in this pass**: recognizing already-installed CurseForge mods during a folder scan.
    CurseForge's own file-identification endpoint (`/fingerprints`, confirmed and wired up as
    `getCurseForgeFingerprintMatches`) needs a murmur2 hash of the file with whitespace bytes
    stripped, not a simple file hash - computing one isn't implemented yet, so a CurseForge-
    sourced file sitting in the folder still gets adopted as `source: 'unknown'` by
    `scanForInstalledMods`, same as before this pass. A real, clearly-scoped follow-up.
  - New `tests/curseforgeClient.test.ts` (class/loader-type selection, API key header, 401/403
    error message, file sorting, empty-fingerprint-list shortcut),
    `tests/curseforgeInstallPlan.test.ts` (the dependency-walk algorithm - all the same cases as
    Modrinth's own test file, including the diamond graph and cycle), and
    `tests/minecraftModsCurseForge.test.ts` (search merging/sorting/filtering/fallback, install
    with and without a required dependency, rejecting a no-distribution file, update-check
    flagging and API-key-cleared skip).
