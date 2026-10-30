/**
 * PoC Node sidecar: a persistent child process the Rust shell spawns and talks to over
 * newline-delimited JSON on stdin/stdout, standing in for what a real migration's sidecar
 * would look like - the actual application logic (imported below from the real
 * src/main/store.ts, completely unmodified) runs exactly as it does today, in Node; only the
 * transport (Electron's ipcMain <-> this process's stdin/stdout) and the host (Electron's own
 * Node integration <-> a plain `node` child process spawned by Rust) are different.
 *
 * Two message shapes travel over stdout: a response (has "id", answers one specific request)
 * and a push event (has "event" instead, unsolicited - the Rust side forwards these to the
 * webview as ordinary Tauri events). profiles.list/profiles.save below are real calls into
 * store.ts; the 'profiles-changed' push wraps store.ts's own `profileEvents` EventEmitter,
 * unmodified - proving a live update (the kind every console/status view in the real app
 * needs) can reach the webview without the webview having asked for it first.
 *
 * log.record/'manager-log-entry' below proves the same push mechanism carries a SECOND,
 * independent event source too (lib/managerLog.ts's own `managerLogEvents`, a different real
 * subsystem backed by a JSONL file rather than electron-store) - multiplexed over the exact
 * same stdout pipe by event name, which is the shape a real migration needs for every one of
 * the real app's several independent live-update channels (console output, server status,
 * manager log, ...), not just one.
 *
 * console.* below is the actual headline case all of the above was standing in for: the real
 * per-server live console feed. watchLogFile (serverProcess.ts) and
 * parseLogChunkWithDate/createLogEventCaches/readLogBacklog (lib/logEvents.ts) are the exact,
 * unmodified functions the desktop Manager/Web Dashboard's own console tabs already use -
 * nothing here is a stand-in parser. The only genuinely new code is the small amount of glue
 * wiring watchLogFile's onChunk callback to a push-event line, plus a test-only method
 * (console.appendTestLine) to simulate a game server writing new output, since there's no real
 * ARK/Minecraft server process available to generate one in this sandbox.
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { listProfiles, saveProfile, profileEvents, getRunningPids, getRunningStartedAt } from '../../src/main/store'
import { logManagerEvent, newTaskId, managerLogEvents, readManagerLog } from '../../src/main/lib/managerLog'
import {
  watchLogFile,
  getLogFilePath,
  startServer,
  stopServer,
  getStatus,
  serverEvents,
  getExecutablePath,
  adoptPersistedProcesses
} from '../../src/main/lib/serverProcess'
import { readLogBacklog, parseLogChunkWithDate, createLogEventCaches } from '../../src/main/lib/logEvents'
import { openProfilesFolder } from '../../src/main/lib/systemFolders'
import { copyProfile, moveProfile } from '../../src/main/lib/profileCopyMove'
import { startDiscordBot, stopDiscordBot, getDiscordBotStatus } from '../../src/main/lib/discordBot'
import { applyWebDashboardSettings, stopWebDashboard, getWebDashboardStatus } from '../../src/main/lib/webDashboard'
import { getSettings, saveSettings } from '../../src/main/store'
import { send, resolveRustResponse } from './rpcToRust'
import type { ServerProfile } from '../../shared/types'

interface RpcRequest {
  id: number
  method: string
  params?: unknown
}

const methods: Record<string, (params: unknown) => unknown> = {
  'profiles.list': () => listProfiles(),
  // No schema validation here on purpose - store.ts itself does none either (TS types are
  // compile-time only), and this PoC is about proving the write path reaches the real
  // function and its real side effects (persisting to disk, emitting profileEvents), not
  // about adding input validation a real migration would still need to design properly.
  'profiles.save': (params) => saveProfile(params as ServerProfile),
  // Real, unmodified copyProfile()/moveProfile() from lib/profileCopyMove.ts - a write path
  // with a native dialog on the renderer side (ProfileManagementView.tsx's "Browse..." button,
  // see main.rs's dialog_select_directory) in front of it, unlike every read/write above. The
  // real ipc/profiles.ts handler also re-runs applyBackupSchedule/syncPlayerBackupWatch/
  // applyScheduledRestart/applyScheduledDinoWipe/applyScheduledRconCommands/
  // applyScheduledMaintenance on the result - deliberately left out here: those re-arm file
  // watchers and cron-like timers against the *new* install path, which this PoC has no way to
  // observe (no real server process, no real backup content) and isn't part of what this
  // increment is testing (whether copy/move + a native folder picker can round-trip through the
  // sidecar at all). A real migration still has to port that wiring.
  'profiles.copy': async (params) => {
    const { profileId, destInstallDir, newName } = params as {
      profileId: string
      destInstallDir: string
      newName: string
    }
    const profile = listProfiles().find((p) => p.id === profileId)
    if (!profile) throw new Error(`Unknown profile: ${profileId}`)
    const copied = await copyProfile(profile, destInstallDir, newName)
    const profiles = saveProfile(copied)
    return { profile: copied, profiles }
  },
  'profiles.move': async (params) => {
    const { profileId, destInstallDir, newName } = params as {
      profileId: string
      destInstallDir: string
      newName: string
    }
    const profile = listProfiles().find((p) => p.id === profileId)
    if (!profile) throw new Error(`Unknown profile: ${profileId}`)
    const moved = await moveProfile(profile, destInstallDir, newName)
    const profiles = saveProfile(moved)
    return { profile: moved, profiles }
  },
  // Real write into lib/managerLog.ts's own JSONL file, through the real logManagerEvent -
  // proves a second, differently-shaped real subsystem (file-backed, async persistence)
  // behaves the same way through this sidecar as the in-memory-then-electron-store one above.
  'log.record': async (params) => {
    const message = typeof params === 'string' ? params : 'Test entry from the Tauri PoC sidecar'
    // logManagerEvent resolves void - the RPC response still needs a concrete result value
    // (not undefined, which JSON.stringify would drop, leaving neither "result" nor "error"
    // in the line Rust reads) so { ok: true } stands in for "the write finished".
    await logManagerEvent(newTaskId('poc'), 'Tauri PoC', message, 'info')
    return { ok: true }
  },
  // Real, unmodified readManagerLog() - backs the real ManagerLogView.tsx's window.api.
  // managerLog.getLog() (see "A real React page" below), reading the exact same JSONL file
  // log.record/managerLogEvents already write to.
  'log.getAll': () => readManagerLog(),
  // Real, unmodified startServer()/stopServer()/getStatus() from serverProcess.ts - the actual
  // headline capability of a "server manager", untouched by this PoC until now. startServer
  // really does `child_process.spawn(getExecutablePath(profile), buildLaunchArgs(profile), ...)`
  // - getExecutablePath resolves platform-specific (def.executableLinux on this Linux sandbox,
  // e.g. "ShooterGame/Binaries/Linux/ArkAscendedServer" under the profile's installDir), so
  // there's no Electron coupling to shim here at all - this was always going to run as a plain
  // OS process spawn no matter what hosts it. No real ARK/Minecraft dedicated server binary
  // exists in this sandbox, so standalone testing points a profile's installDir at a small
  // long-running stand-in script placed at that exact resolved path (same spirit as
  // console.appendTestLine simulating a game server's log output below) - proves the real
  // spawn/PID-tracking/status/graceful-stop-then-force-kill round trip without needing the real
  // game server binary, the same way the bot subsystem's fork() bug was found without a real
  // Discord bot token. stopServer's real shutdown sequence (RCON SaveWorld -> DoExit -> grace
  // period -> force kill) runs unmodified too; the stand-in script never responds to RCON, so
  // every real stop exercises the force-kill fallback path - see README for what this does and
  // doesn't confirm.
  'server.start': (params) => {
    const { profileId } = params as { profileId: string }
    const profile = listProfiles().find((p) => p.id === profileId)
    if (!profile) throw new Error(`Unknown profile: ${profileId}`)
    return startServer(profile)
  },
  'server.stop': async (params) => {
    const { profileId, graceMs } = params as { profileId: string; graceMs?: number }
    const profile = listProfiles().find((p) => p.id === profileId)
    if (!profile) throw new Error(`Unknown profile: ${profileId}`)
    return stopServer(profile, graceMs)
  },
  'server.status': (params) => getStatus((params as { profileId: string }).profileId),
  // Test-only: writes a small long-running shell script to the real, unmodified
  // getExecutablePath(profile)'s resolved path - standing in for a real ARK/Minecraft dedicated
  // server binary, since this sandbox has none (same role as console.appendTestLine above, for
  // the process-spawn side rather than the log-output side). Exits on SIGTERM, same as a real
  // game server - see README for what this found about stopServer()'s shutdown sequence when a
  // first version of this script ignored it instead. `withStartupMarker` additionally has the
  // script write the real STARTUP_COMPLETE_MARKER string (copied here - serverProcess.ts keeps
  // it as a private const, not worth exporting just for this test fixture) to the real,
  // unmodified getLogFilePath(installDir) a few seconds after launch, the same way a real ARK
  // server's own engine log announces it has actually finished loading - proving
  // watchLogFileForMarker()'s real 'starting' -> 'running' transition, not just the untested
  // code path every earlier round's silent fake script left unreachable.
  'server.installTestExecutable': (params) => {
    const { profileId, withStartupMarker } = params as { profileId: string; withStartupMarker?: boolean }
    const profile = listProfiles().find((p) => p.id === profileId)
    if (!profile) throw new Error(`Unknown profile: ${profileId}`)
    const exePath = getExecutablePath(profile)
    fs.mkdirSync(path.dirname(exePath), { recursive: true })
    const markerLine = 'Server has completed startup and is now advertising for join'
    const logPath = getLogFilePath(profile.installDir)
    // Creates the (empty) log file immediately, before watchLogFile's first poll tick, then
    // appends the marker several seconds later on a separate tick - matching a real ARK
    // server's own shape (the log exists and is growing well before the startup-complete line
    // shows up in it). Appending the marker to a log file watchLogFile hasn't polled even once
    // yet would instead get silently absorbed into its first "establish a size baseline" tick
    // (see watchLogFile's own comment on that) and never reported as a chunk at all - a real
    // ordering requirement found by hitting exactly that race first.
    const markerWrite = withStartupMarker
      ? `\nmkdir -p "$(dirname "${logPath}")"\n: > "${logPath}"\n(sleep 3; printf '%s\\n' "[STAGING][  0]${markerLine}" >> "${logPath}") &\n`
      : ''
    fs.writeFileSync(exePath, `#!/bin/sh\ntrap 'exit 0' TERM${markerWrite}\nwhile true; do sleep 1; done\n`)
    fs.chmodSync(exePath, 0o755)
    return { ok: true, exePath }
  },
  // Real backlog read straight off a ShooterGame.log-shaped file - same function the desktop
  // Console tab and Web Dashboard both call on open/reconnect.
  'console.backlog': (params) => readLogBacklog((params as { installDir: string }).installDir),
  // Starts (or restarts) the real watchLogFile poller against installDir's log file, parsing
  // each newly-written chunk with the real parser and pushing one 'console-line' event per
  // parsed line - this is the actual live-console-feed shape, not a simplified stand-in.
  'console.watch': (params) => {
    const { installDir } = params as { installDir: string }
    const logPath = getLogFilePath(installDir)
    // watchLogFile's first poll tick only ever establishes a size baseline, never reports
    // anything (by design - it must not treat a server's pre-existing log as "new" on every
    // Manager restart). If the file doesn't exist yet, that baseline tick is deferred until it
    // does, so touching it into existence here (as 0 bytes, if missing) means the very next
    // append is the first thing actually reported, rather than silently eaten by whichever
    // tick happens to be the first one to see the file at all.
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '')
    stopConsoleWatch?.()
    const caches = createLogEventCaches()
    stopConsoleWatch = watchLogFile(installDir, (chunk) => {
      for (const event of parseLogChunkWithDate(chunk, caches)) {
        send({ event: 'console-line', data: event })
      }
    })
    return { ok: true, watching: logPath }
  },
  // Test-only: simulates a game server appending output to its own log file, since this
  // sandbox has no real ARK/Minecraft process to generate one. Formats a line exactly as
  // parseLogLine's own LOG_LINE_RE expects so the real parser (not a stand-in) accepts it.
  'console.appendTestLine': (params) => {
    const { installDir, message } = params as { installDir: string; message: string }
    const logPath = getLogFilePath(installDir)
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    const now = new Date()
    const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
    const stamp = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}:${pad(now.getMilliseconds(), 3)}`
    fs.appendFileSync(logPath, `[${stamp}][  0]${message}\n`)
    return { ok: true }
  },
  // Real, unmodified lib/systemFolders.ts function - the whole point of the `shell.openPath`
  // round trip this proves (see electronShim.ts/rpcToRust.ts), not a synthetic test method.
  // Every real call site in the app follows this exact shape: call a systemFolders.ts
  // function, let it call `shell.openPath` itself, surface whatever it throws as the RPC
  // error - same as every other real function this sidecar calls into.
  'folders.openProfiles': async () => {
    await openProfilesFolder()
    return { ok: true }
  },
  // Real, unmodified lib/discordBot.ts - proving the bot subsystem, not just the main-process
  // logic this PoC has otherwise covered. startDiscordBot() itself calls Node's `fork()` with
  // ELECTRON_RUN_AS_NODE=1 (meaningless, harmless outside Electron - fork() already runs
  // process.execPath, i.e. this sidecar's own plain Node/SEA binary, with or without that
  // var) to spawn sidecar/bot/index.js, the real src/bot/index.ts bundled unmodified by
  // build-bot.mjs - no Electron coupling in src/bot/ at all (confirmed by grepping for "from
  // 'electron'": zero hits). Flips discordBotEnabled/discordBotToken on through the real
  // saveSettings()/getSettings() round trip first, exactly the shape the real Settings UI
  // would send, rather than constructing a fake settings object by hand.
  'bot.start': async () => {
    const settings = saveSettings({
      ...getSettings(),
      discordBotEnabled: true,
      discordBotToken: 'poc.fake.token.not.real'
    })
    await startDiscordBot(settings)
    return getDiscordBotStatus()
  },
  'bot.stop': () => {
    stopDiscordBot()
    return { ok: true }
  },
  'bot.status': () => getDiscordBotStatus(),
  // Real, unmodified lib/webDashboard.ts - the third real subsystem from the original size
  // estimate. Unlike the bot, this one was never a separate process even in the real app - it's
  // an in-process http.Server/https.Server started directly by the main process - so there's no
  // fork()/SEA interaction to worry about here (see "The Discord bot subsystem" for why that
  // mattered there). applyWebDashboardSettings/getWebDashboardStatus called exactly as the real
  // Settings UI would, through the same real saveSettings()/getSettings() round trip.
  'dashboard.start': async (params) => {
    const { port } = params as { port: number }
    const settings = saveSettings({
      ...getSettings(),
      webDashboardEnabled: true,
      webDashboardPort: port,
      webDashboardHost: '127.0.0.1',
      webDashboardAuthEnabled: false
    })
    applyWebDashboardSettings(settings)
    return getWebDashboardStatus()
  },
  'dashboard.stop': () => {
    stopWebDashboard()
    return { ok: true }
  },
  'dashboard.status': () => getWebDashboardStatus()
}

let stopConsoleWatch: (() => void) | null = null

// Tauri's own event names only accept alphanumerics, '-', '/', ':', '_' - found by actually
// running this against a real Tauri app.emit() call, not from reading the docs - 'profiles-
// changed' here, not 'profiles.changed' matching the RPC method naming below. Same for
// 'manager-log-entry' vs. the real app's own 'log' event name on managerLogEvents.
profileEvents.on('changed', (profiles) => send({ event: 'profiles-changed', data: profiles }))
managerLogEvents.on('log', (entry) => send({ event: 'manager-log-entry', data: entry }))
// A third independent push source: serverProcess.ts's own `serverEvents` 'status' emitter -
// the one every server card/detail page in the real app subscribes to for live state
// ('starting'/'running'/'stopping'/'stopped'/'error'), not just what a one-off status poll
// would show.
serverEvents.on('status', (status) => send({ event: 'server-status', data: status }))

// Real, unmodified adoptPersistedProcesses() - the real app's own answer to "what happens to a
// running server if the Manager itself crashes or restarts": startServer() launches it detached
// and unref'd (see serverProcess.ts) specifically so the OS process survives that, and this is
// what re-attaches to it afterward instead of losing track of it (or letting a second instance
// start on the same ports). The real index.ts calls this once at app startup, after registering
// its own watchers (so an adopted server's status broadcast still reaches them) and before
// anything else touches `running` - mirrored here in the same order, once per sidecar process
// lifetime, which is the right analog: a new sidecar process is spawned exactly when the real
// app's main process would be (a fresh `cargo tauri` run, not a page reload), so "restart the
// whole app" and "a new sidecar process starts" are the same event in this architecture.
adoptPersistedProcesses(listProfiles(), getRunningPids(), getRunningStartedAt())

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(line)
  } catch (err) {
    console.error('sidecar: failed to parse incoming line:', line, err)
    return
  }
  // A line with no "method" field is a response to one of THIS sidecar's own outgoing
  // shell-request calls (see rpcToRust.ts), not a command from Rust - every command line
  // always carries one. Checked first since both shapes otherwise look alike (both just
  // {id, ...}).
  if (parsed.method === undefined) {
    const handled = resolveRustResponse(parsed.id as number, parsed.result, parsed.error as string | undefined)
    if (!handled) console.error('sidecar: response for unknown/already-resolved request id:', line)
    return
  }
  const request = parsed as unknown as RpcRequest
  const handler = methods[request.method]
  if (!handler) {
    send({ id: request.id, error: `Unknown method "${request.method}"` })
    return
  }
  try {
    const result = await handler(request.params)
    send({ id: request.id, result })
  } catch (err) {
    send({ id: request.id, error: (err as Error).message })
  }
})

// Tells the Rust side the sidecar is up and its stdio pipes are ready to receive requests -
// spawning a child process and it actually being ready to read stdin aren't the same instant.
console.error('sidecar: ready')
