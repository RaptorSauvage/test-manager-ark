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
