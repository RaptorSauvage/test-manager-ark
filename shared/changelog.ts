// User-facing "What's New" entries - short and non-technical, unlike README.md's own
// changelog (which documents every change in full engineering detail, file by file, for
// whoever's developing the app next). Add a new entry here alongside each README entry
// whenever a change is actually worth telling a user about; skip pure refactors/internal
// fixes with no visible behavior change. Newest first.

export interface ChangelogEntry {
  date: string
  title: string
  details: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-10-23',
    title: 'Fixed a flash when returning to the Dashboard from a server\'s own page',
    details: [
      'Clicking Back used to briefly show wrong information on the Dashboard before correcting itself a moment later - map names as raw ids ("TheIsland_WP" instead of "The Island"), the hardware cards\' subtext as generic placeholder text, a server\'s detected game version, whether its install was even found, and worst of all a server that was actually running could flash "Stopped" again for a bit. All of that now loads once and stays loaded across navigation instead of resetting every time you come back to the Dashboard.'
    ]
  },
  {
    date: '2026-10-23',
    title: 'INI Templates (Tools menu) - a shared base config plus per-server overrides',
    details: [
      'New Tools > INI Templates: write a generic GameUserSettings.ini/Game.ini template once for the whole cluster, then apply it to any server (or every ARK server at once). Applying merges it key by key into that server\'s real config files - a setting it already has is updated right where it already sits (so it stays together with the rest of that section instead of splitting off into a separate block), a new one is added to its section, and any comment written directly above a key in the template comes along with it when that key is new. Everything else already in the file, including anything edited by hand, is left completely alone. SessionName is always set to that server\'s own name automatically, so you never need to repeat it in a template.',
      'Each server can also have its own override, for the genuinely server-specific lines, merged the same way and winning over the generic template for anything both set. Its own "Server Name" field lets a server be known by a different SessionName than its Manager profile name - e.g. a short internal label here, a longer public name in the server browser - and always wins over anything either template\'s own SessionName line says, so pasting in a whole pre-existing .ini file can never rename the server by accident.',
      'Each of the four text boxes (generic + override, times GameUserSettings.ini/Game.ini) has an "Import from file..." button, for anyone who already has these files written by hand and would rather load them than retype them.',
      'The per-server override table is organized by cluster group (same as the Dashboard), and a hidden server is left out of it entirely.',
      'Every Apply snapshots the previous file content into that server\'s own config history, so an applied template shows up right alongside manual edits in the Files tab\'s history/diff view.'
    ]
  },
  {
    date: '2026-10-23',
    title: 'Event Scheduler: a manual mod change during an event\'s window now sticks',
    details: [
      'Fixed: restarting the Manager (or saving/re-enabling an event) while one of its mod(s) had been added/removed by hand partway through its active window used to force that mod back to whatever the schedule said it "should" be right now - undoing the manual change. The scheduler now only replays a start/end transition it actually missed (e.g. the Manager was closed through it), not one that already happened, so a deliberate manual change in between is left alone until the event\'s next real transition.'
    ]
  },
  {
    date: '2026-10-23',
    title: 'Event Scheduler (Tools menu) - automatic seasonal mod events',
    details: [
      'New Tools > Event Scheduler: create events that automatically add a set of mod IDs to your servers\' mod lists when the event starts, and remove them again when it ends - e.g. a Halloween or Christmas mod pack that only runs during that window.',
      'Each event can repeat every year on the same date (handles a window that crosses the year boundary, like Dec 18 - Jan 5, correctly) or fire once; target all servers or a specific few; and optionally trigger a graceful shutdown-then-restart when it starts/ends so the mod change takes effect immediately instead of on the next manual restart.',
      'A reconciliation pass runs whenever an event is created/edited and every time the Manager starts, so the right mods are present (or absent) immediately even if the Manager was closed through an event\'s start or end - not just when a timer happened to be running.',
      'A History tab records every time an event actually added or removed mods, including any per-server failures.'
    ]
  },
  {
    date: '2026-10-22',
    title: 'Network usage bar is back, and the Minecraft Dashboard now matches ARK\'s own redesign',
    details: [
      'The hardware stats bar has a third card again: Network Usage, with separate upload/download bars and the link interface/speed underneath - this machine\'s whole network link rather than a per-server number (there\'s no reliable way to attribute network traffic to one process the way CPU/RAM already are). Polled far less often than the old version that got flagged by antivirus software, trading a bit of freshness for fewer background queries.',
      'The Minecraft Dashboard has been rebuilt to match everything the ARK Dashboard already got: the denser server-card layout with a status-colored stripe and icon-only Start/Stop/Restart/Kill buttons, a "..." card menu, Status/Type/Sort filters plus a Grid/List toggle, and per-group bulk action buttons - the old standalone "Server Controls" and "Global Performance" panels are gone, replaced by the same hardware stats bar ARK uses.'
    ]
  },
  {
    date: '2026-10-22',
    title: 'Map Manager\'s official maps table merged by map, and a restyled Settings screen',
    details: [
      'Map Manager\'s Official Maps table now lists one row per map (Display Name, Map ID (ASA), Map ID (ASE)) instead of a separate row per game - a handful of maps only exist on one of the two (Lost Colony, Dragontopia, Astraeos are ASA-only) and show a dash on the other side.',
      'Settings is reorganized into a left-side nav grouped by section (Application, Integrations) instead of a single row of top tabs, with each section\'s own icon and description - the drawer itself is also a bit wider to give the new layout room to breathe.'
    ]
  },
  {
    date: '2026-10-22',
    title: 'Server groups, a Map Manager, and right-side drawers for Settings/SteamCMD/Profile Management',
    details: [
      'A server card\'s own "..." menu now has a Group entry - assign it to an existing group, start a brand new one, or send it back to "No group", without opening that server\'s Settings tab.',
      'File > Manage Groups is the new one-stop place to create, rename, or delete the groups servers sort into on the Dashboard - renaming/deleting updates every server currently in that group, and an empty group you just created still shows up ready to receive servers.',
      'Tools > Map Manager - a new screen for the custom/modded maps available to server configuration (maps.json stays read-only/official). A custom map can carry an optional Mod ID, which gets added to a server\'s mod list automatically the moment that map is selected in its Settings tab.',
      'Settings, SteamCMD, Profile Management, and the new Map Manager now open as a right-side drawer over whatever page was already showing, instead of replacing it outright - switching straight between them from the title bar\'s own menus works without closing one first.'
    ]
  },
  {
    date: '2026-10-22',
    title: 'Fixed: Dashboard and Cluster Dashboard sidebar icons were swapped',
    details: [
      'The grid icon now correctly points to Dashboard/Minecraft Servers, and the server-rack icon to Cluster Dashboard - they had ended up swapped in the previous sidebar icon pass.'
    ]
  },
  {
    date: '2026-10-22',
    title: 'Sidebar: icon-only, bigger icons, fixed What\'s New/Log/Settings not staying at the bottom',
    details: [
      'The sidebar is now a narrow icon-only dock - no more text labels, just a bigger icon per item (hover for its name as a tooltip). Dashboard/Minecraft Servers, Cluster Dashboard, Players, Log and Settings use real line-art icons (What\'s New keeps its bell emoji - no matching artwork for that one yet).',
      'The current page is highlighted with a rounded pill instead of the old flat rectangle/left-border strip, matching the rounded-corner look the rest of the app already uses (cards, title bar menus, buttons).',
      'Fixed: What\'s New/Log/Settings had stopped staying pinned to the bottom of the sidebar - a CSS rule added for the rounded-pill icon buttons was unintentionally overriding the one that pushes that group down, even though it looked unrelated.'
    ]
  },
  {
    date: '2026-10-22',
    title: 'Fixed: a restarting/errored server\'s card kept its stopped (red) side stripe',
    details: [
      'Every other status already had a matching color for the card\'s left-edge stripe, but "restarting" and "error" didn\'t - both fell back to the default stopped color. They now match the same colored badge a card already showed for those two states (orange for restarting, red for error).'
    ]
  },
  {
    date: '2026-10-22',
    title: 'A proper "Create New Server" wizard, merged with Import',
    details: [
      'The 3 separate header buttons (+ Add server / Import existing server / Import profile file...) are now one "+ Add Profile" button, opening a 3-step wizard: Basic Information (name + install directory, with live validation), Copy Configuration (fresh install, copy settings from an existing profile, or - the two old import buttons, now folded in here - import an existing install or a profile file), and Additional Options (an "Install ArkAPI automatically" checkbox - not wired up to anything real yet - plus a Review & Confirm summary).',
      'Choosing a fresh install (or copying config from an existing profile) now runs the actual SteamCMD install right there, with a live progress bar/stage (Installing/Verifying/Complete) and the real console output, instead of silently creating an empty profile you had to go install yourself afterward.',
      'Choosing either import option behaves exactly as before - same pickers, same behavior - just reached from this one button now.',
      'The Dashboard header is lighter now that SteamCMD/Profile Management moved into the title bar\'s Tools menu (alongside the new Add Profile) - just the (smaller) title and the blue "+ Add Profile" button remain. The search box moved down onto the filters row, centered between Status/Map/Sort and the Grid/List toggle.'
    ]
  },
  {
    date: '2026-10-22',
    title: 'Custom title bar, styled like the rest of the app',
    details: [
      'The window no longer uses the OS title bar - it now draws its own, in the same dark theme as everything else, with File/Tools/Help menus, the app version, and its own minimize/maximize/close buttons.',
      'File: Settings, Open Profiles Folder, Open Data Folder, Quit.',
      'Tools: Add Profile, SteamCMD, Profile Management, Manager Log.',
      'Help: What\'s New.',
      'The bell icon is a shortcut to What\'s New; the grid icon next to it doesn\'t do anything yet.'
    ]
  },
  {
    date: '2026-10-22',
    title: 'Dashboard redesign: denser cards, hardware stats bar, list view, filters',
    details: [
      'New stats bar at the top of the Dashboard showing the combined CPU/RAM used by your running ARK servers (with the CPU model/core count and total system RAM as context). The CPU percentage is scaled against the machine\'s full thread count (100% = every thread saturated), not the old "100% = one thread" process convention, so it no longer shows numbers like "112%" on a many-core machine.',
      'Server cards are denser (Port/Map/Players/Uptime/CPU/Memory as a small grid), show the installed game version next to the name, use icon-only Start/Stop/Restart/Update/Kill buttons with the same colors as before, and pack up to 6 per row on a wide window - a group with fewer servers than that (e.g. a 3-server "Testing" group) keeps the exact same card size as a full row instead of stretching to fill the rest of the row.',
      '"Manage/Hide/Delete" moved into a "..." dropdown on each card, now also including a direct "Settings" shortcut.',
      'New Status/Map/Sort filters next to the search box, and a Grid/List toggle - List shows every server as rows in one dense table instead of cards. Sort defaults to "Default order" (your profiles\' own order, unsorted) rather than always alphabetizing them.',
      'A thin divider now separates ungrouped servers from the first cluster group, and between groups.',
      'The old "Server Controls" panel (Start/Stop/Restart/Update All) is gone - each group now has its own Start/Stop/Restart/Update-all buttons right on its header line, acting only on that group instead of every server at once.',
      'The Update button (on a card and on a group header) now uses a shield-checkmark icon instead of the plain up-arrow, in the same blue as the rest of that button family.',
      '"Global Performance" and "Official Server Status" (the sidebar panels) are temporarily removed while the new layout settles.',
      'Fixed: the stats bar briefly queried whole-machine CPU/RAM/network usage every few seconds, which could get the Manager flagged by some antivirus software (reported with Malwarebytes) for repeatedly spawning background OS queries - it now only reads the ARK servers\' own already-tracked usage, nothing new to poll.'
    ]
  },
  {
    date: '2026-10-22',
    title: 'Fixed: a beta/PTR-pinned server still showed "update available" after updating',
    details: [
      'SteamCMD caches its own "latest build id" lookup on disk, and that cache can stay stale for a less-common branch (a beta/PTR one) even after `+app_info_update` - so the check could keep comparing against an old, wrong number even though SteamCMD\'s own update just confirmed nothing had changed.',
      'The check now clears that local cache before every poll, forcing a fresh lookup each time.',
      'Hovering over "A server update is available" now shows the installed vs. latest build id numbers, to make a mismatch like this easier to spot and report.'
    ]
  },
  {
    date: '2026-10-21',
    title: 'Fixed: a server on a beta branch always showed "update available"',
    details: [
      'The Analytics tab\'s "New update" check now compares a beta-pinned server against that beta branch\'s own latest build id instead of always the public branch\'s - a server fully up to date on its beta no longer shows a permanent false "update available".',
      'Same fix applies to the scheduled restart\'s "only if an update is available" condition.'
    ]
  },
  {
    date: '2026-10-21',
    title: 'Players moved to the sidebar, hidden servers excluded, tray menu overhaul',
    details: [
      '"Players" is now its own tab in the ARK sidebar instead of a button on the Dashboard, and the Live Players tab groups servers by cluster the same way the Dashboard does.',
      'A hidden server (Dashboard\'s "hide" toggle) no longer shows up anywhere on the Players screen.',
      'Right-clicking the system tray icon now also shows how many ARK/Minecraft servers are running, total connected players, and total CPU/RAM used - plus a new "Tout arrêter" item to stop every running server at once (with a confirmation).'
    ]
  },
  {
    date: '2026-10-21',
    title: 'Discord chat bridge + tame/death/mission events channel',
    details: [
      "Each server can now relay its in-game chat to a Discord channel and back (set a \"Discord Chat Channel ID\" in Settings), and post tame/tamed-dino-death/mission events to a separate channel (\"Discord Events Channel ID\") - both off by default, and independent of each other.",
      'Set the same channel id on every server in a cluster to share one channel between them.',
      'Requires turning on "Message Content Intent" for the bot in the Discord Developer Portal for the chat bridge\'s Discord-to-game direction to work.'
    ]
  },
  {
    date: '2026-10-21',
    title: 'Live player roster with Kick/Ban/Whitelist, new Whitelist tab',
    details: [
      'The Players screen now has a "Live Players" tab showing who\'s actually connected to a chosen server right now, with Kick/Ban/Whitelist buttons on each row.',
      'A new "Whitelist" tab tracks known/trusted players per server - it\'s a shared note, not an actual join restriction.'
    ]
  },
  {
    date: '2026-10-21',
    title: 'Fixed: server updates silently running on a beta branch',
    details: [
      "Once any one profile had ever updated with a Steam beta branch enabled, other updates could keep running on that same beta too, even with the beta toggle off (sometimes showing as an update landing on a surprisingly newer version than expected).",
      "Updates now both explicitly request the public branch when beta isn't enabled, and clear the server's own saved SteamCMD state whenever its beta selection is actually changing, instead of trusting SteamCMD to switch on its own."
    ]
  },
  {
    date: '2026-10-21',
    title: 'Fixed: Discord bot status message abandoned on a network blip',
    details: [
      "A temporary network hiccup while the bot updated its status message could make it give up on the existing message and start posting a new one instead, leaving the old one behind unchanged.",
      "The bot now only posts a replacement message when the old one is genuinely gone (deleted) - any other failure just retries on the same message next refresh."
    ]
  },
  {
    date: '2026-10-21',
    title: 'Scheduled restart: "only if a server update is available" condition',
    details: [
      'The scheduled restart (Server Management tab) now has a third opt-in condition: "Only if a server update is available" - checked against the same SteamCMD build id comparison as the Analytics tab\'s "New update" status.',
      'When checked, a restart that comes due with nothing new to install is skipped entirely for that occurrence and tried again next time, just like the existing "only if no players are connected" condition.',
      'ARK: Survival Ascended only - Evolved doesn\'t support update checking, so the checkbox is hidden for it.'
    ]
  },
  {
    date: '2026-10-21',
    title: 'Notepad++-style syntax coloring, plus .json and .log support',
    details: [
      'The file editor (desktop Manager and web dashboard) now colors .ini, .json, and .log files Notepad++-style: sections, keys, strings, numbers, booleans, comments, timestamps, and log levels each get their own color.',
      'You can now open .json files (editable, with the same save history as .ini) and .log files (view-only, since a running server may still be writing to them) - not just .ini.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'File Browser on the desktop Manager, Notepad++-style tabbed editor',
    details: [
      'The Files tab (browse, open, delete, edit .ini files) is now also available in the desktop Manager, not just the web dashboard.',
      'Both editors now support several open files at once, each its own tab with a dirty indicator and a close button, plus a "Files" tab to get back to the folder view without losing the other open tabs.',
      'The editing area is now bigger, screen-responsive, and has line numbers.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Players screen merged, redesigned ban picker, RCON scheduler overhaul',
    details: [
      '"Player Bans" and "Player Activity" are now one "Players" screen with a sidebar to switch between them, instead of two separate buttons.',
      'Banning a player now shows servers in columns grouped the same way the Dashboard groups them, plus an "All" button - instead of one long scrollable checkbox list.',
      'Scheduled RCON Commands moved into its own block (Server Management tab) and gained a trigger type per command - Fixed Time (as before), Interval (repeats every N seconds while the server runs), or Timeless (manual only) - plus a player-requirement condition (always / only if empty / only if players online) and a "Run now" button.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Config edit history and diff',
    details: [
      'The raw .ini editor now keeps every previous version of a file you save - a "History" list under the editor shows each past save with "View diff" (colored line-by-line comparison against the current file) and "Restore" buttons.',
      'Restoring an older version saves the current one to history first, so nothing is ever lost.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Raw .ini editor in the web dashboard',
    details: [
      'In the Files tab, click any .ini file to edit its raw text directly in the browser and save it - no need to download, edit locally, and re-upload.',
      'Limited to .ini files only, same admin-only access as the rest of the Files tab.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Web dashboard file browser',
    details: [
      'New "Files" tab (admin accounts only) - browse a server\'s whole install directory from the web dashboard: navigate folders, download or delete individual files.',
      'Works for both ARK and Minecraft servers. Deleting is limited to files, not folders, to keep a remote web UI from making an entire-folder mistake.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Chained scheduled maintenance (Stop → Backup → Update → Start)',
    details: [
      'New "Scheduled Maintenance" section (Server Management tab) - one schedule that runs the whole chain automatically: stops the server, takes a backup, updates it via SteamCMD, then starts it back up.',
      'Independent of the regular Restart schedule above it - a failed backup still lets the update and restart happen.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Conditional scheduled restart ("only if empty")',
    details: [
      'New checkbox on the scheduled Restart (Server Management tab): "Only if no players are connected" - a restart that comes due while anyone\'s online is skipped entirely and retried at the next scheduled occurrence, instead of kicking everyone off mid-session.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Generic RCON command scheduler',
    details: [
      "Each ARK server's Server Management tab now has a \"Scheduled RCON Commands\" section - add any number of commands, each on its own day/time schedule, independent of the dedicated Restart/Dino Wipe schedules above it.",
      'Useful for anything you\'d otherwise have to remember to type by hand, like a ServerChat reminder before a restart.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Player activity/playtime tracking',
    details: [
      'Settings > General > "Track player activity/playtime" - once on, the new "Player Activity" button on the Dashboard shows total playtime per player, merged across every ARK server, plus a recent-sessions log.',
      'Off by default, and takes effect immediately on already-running servers once turned on.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Discord alert when a watched player joins',
    details: [
      'Settings > Discord Bot > "Player join alert" - pick a channel and add names/ids to watch, and the bot posts there the moment one of them joins any ARK server.',
      'Matches either the in-game name or the Steam/EOS id, case-insensitively, across the whole cluster at once.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Centralized player bans',
    details: [
      'New "Player Bans" screen (ARK only) - ban a player id across any of your servers from one place, and see every ban merged into one list instead of checking each server separately.',
      'On the web dashboard, right-clicking a connected player now offers "Ban" next to "Kick", with an optional reason.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Cluster backup export/import',
    details: [
      'Settings > General > "Cluster Backup" - export every ARK/Minecraft profile plus your Settings into one file, for migrating to another PC or keeping a snapshot.',
      'Importing always adds profiles as new ones (never overwrites), and only touches Settings if you check the box for it.'
    ]
  },
  {
    date: '2026-10-20',
    title: 'Search box on both Dashboards',
    details: [
      'Type in the new search field to filter servers by name or group, live - handy once you have more than a handful of servers.',
      'A group with no match is hidden entirely while searching; a group with a match opens automatically even if it was collapsed.'
    ]
  },
  {
    date: '2026-10-17',
    title: "Discord bot no longer spams duplicate status messages",
    details: [
      "Fixed: the bot's ARK/Minecraft status embed could post a brand new message instead of editing the existing one, especially after a Settings save (which restarts the bot).",
      'It now remembers the real message and edits it reliably, even across restarts.'
    ]
  },
  {
    date: '2026-10-17',
    title: 'Only one Manager window at a time',
    details: [
      "Launching the Manager while it's already running (even hidden in the system tray) now just brings the existing window to the front, instead of starting a confusing second instance."
    ]
  },
  {
    date: '2026-10-12',
    title: 'Keep running in the background',
    details: [
      'New option in Settings > General > Startup & Safety: closing the window hides it to a system tray icon instead of quitting - your servers, the web dashboard, and the Discord bot all keep running.',
      'Settings and the Manager Log are now reachable from the sidebar in both ARK and Minecraft mode, not just ARK.'
    ]
  },
  {
    date: '2026-10-11',
    title: 'Fixed a focus bug that could freeze text fields',
    details: [
      'After confirming a delete (or certain other popups), typing into any field could silently stop working until the app was restarted.',
      'Fixed at the source - closing a confirmation popup now reliably hands keyboard focus back to the app.'
    ]
  },
  {
    date: '2026-10-11',
    title: 'Discord status embeds respect your group order',
    details: [
      "Server groups in the bot's Discord status now appear in the same order you've set up on the Dashboard, instead of always alphabetically."
    ]
  },
  {
    date: 'Earlier',
    title: 'Native Discord bot integration',
    details: [
      'The standalone Discord bot is now built into the Manager - no separate program to run.',
      'Status embeds, RCON/admin commands, maintenance mode, scheduling, and CurseForge mod update alerts, all configured from Settings > Discord Bot.'
    ]
  },
  {
    date: 'Earlier',
    title: 'Minecraft server support',
    details: [
      'The Manager now manages Minecraft servers (Vanilla/Paper/Spigot/Fabric/Forge/NeoForge/Sponge) alongside ARK ones, with its own Dashboard, mods/plugins, backups, and scheduling.',
      'The web dashboard gained a matching Minecraft section, and got a pass for phone-sized screens.'
    ]
  }
]
