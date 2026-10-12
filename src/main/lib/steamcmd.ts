import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { ServerProfile } from '@shared/types'
import { type GameId, getGameDefinition } from '@shared/games'
import { setUpdating, isRunning, isUpdating, computeTailReadStart } from './serverProcess'
import { getDataDir } from './dataDir'

/** Emits 'log' with a profileId whenever its update log file gets new content, so the
 *  Dashboard's "View update log" panel can refresh itself as soon as there's something
 *  new to show instead of only finding out on its next poll. */
export const steamcmdUpdateEvents = new EventEmitter()

/**
 * Builds the SteamCMD arguments to install/update `game`'s dedicated server into
 * `installDir`. Also works for a first-time install into an empty folder.
 * When `beta.enabled` and `beta.name` (trimmed) are both set, inserts
 * `-beta <name>` right before `validate`, targeting that beta branch instead of the
 * default/public one - same install otherwise.
 */
export function buildUpdateArgs(installDir: string, game: GameId, beta?: { enabled: boolean; name: string }): string[] {
  const betaName = beta?.enabled ? beta.name.trim() : ''
  return [
    '+force_install_dir',
    installDir,
    '+login',
    'anonymous',
    '+app_update',
    getGameDefinition(game).steamAppId,
    ...(betaName ? ['-beta', betaName] : []),
    'validate',
    '+quit'
  ]
}

/**
 * Turns a SteamCMD exit code into a message. Valve has never documented these officially,
 * so only codes confirmed by community reports get a specific explanation - everything
 * else just states the raw code rather than guessing.
 */
export function describeSteamCmdExitCode(code: number): string {
  if (code === 7) {
    return (
      'SteamCMD could not reach Steam\'s servers (exit code 7 - "Steam needs to be online to ' +
      'update"). Check your internet connection and firewall/antivirus - this is common on a ' +
      'freshly installed SteamCMD\'s very first run, since it has to update itself first. Try again.'
    )
  }
  if (code === 8) {
    return (
      'SteamCMD ran out of disk space (exit code 8). A dedicated ARK server is a large install ' +
      '(15-30+ GB) - free up space on the drive your install directory is on and try again.'
    )
  }
  return `SteamCMD exited with code ${code}`
}

/** Where the last SteamCMD update run's output is logged for this profile, so failures are diagnosable. */
export function getUpdateLogPath(profileId: string): string {
  return path.join(getDataDir(), 'logs', `steamcmd-update-${profileId}.log`)
}

/** Reads a file's text content via `onRead`, or logs and returns `fallback` on a disk-level
 *  read failure - every caller below feeds a status display or the install/update flow,
 *  where "can't tell right now" is a safer degrade than crashing the IPC handler that asked.
 *  A real report on Windows showed exactly that (a raw libuv "UNKNOWN: unknown error, read")
 *  breaking Dashboard install-state checks and update-log reads. */
function safeReadFileSync<T>(filePath: string, fallback: T, onRead: (raw: string) => T): T {
  try {
    return onRead(fs.readFileSync(filePath, 'utf-8'))
  } catch (err) {
    console.error(`Failed to read ${filePath}:`, (err as Error).message)
    return fallback
  }
}

/** Returns the last update run's log for this profile, or null if it has never been updated. */
export function readUpdateLog(profileId: string): string | null {
  const logPath = getUpdateLogPath(profileId)
  if (!fs.existsSync(logPath)) return null
  return safeReadFileSync(logPath, null, (raw) => raw)
}

/**
 * SteamCMD's own persistent log, next to its executable - not per-profile, it's appended
 * across every run of this SteamCMD install. Community reports (and our own testing) show
 * SteamCMD's piped stdout/stderr is unreliable on Windows and often carries little to no
 * useful text, while this file has the actual error detail, so it's worth surfacing too.
 */
export function getSteamCmdContentLogPath(steamCmdPath: string): string {
  return path.join(path.dirname(steamCmdPath), 'logs', 'content_log.txt')
}

function contentLogSize(steamCmdPath: string): number {
  const logPath = getSteamCmdContentLogPath(steamCmdPath)
  if (!fs.existsSync(logPath)) return 0
  try {
    return fs.statSync(logPath).size
  } catch (err) {
    console.error(`Failed to stat ${logPath}:`, (err as Error).message)
    return 0
  }
}

/** Returns only the content_log.txt bytes written since `previousSize`, or '' if there's nothing new. */
export function readNewContentLog(steamCmdPath: string, previousSize: number): string {
  const logPath = getSteamCmdContentLogPath(steamCmdPath)
  if (!fs.existsSync(logPath)) return ''
  try {
    const currentSize = fs.statSync(logPath).size
    const readStart = computeTailReadStart(previousSize, currentSize)
    if (readStart === null) return ''
    return fs.readFileSync(logPath).subarray(readStart).toString('utf-8')
  } catch (err) {
    console.error(`Failed to read ${logPath}:`, (err as Error).message)
    return ''
  }
}

/** Where SteamCMD tracks this app's install state within a given install directory. */
export function getAppManifestPath(installDir: string, game: GameId): string {
  return path.join(installDir, 'steamapps', `appmanifest_${getGameDefinition(game).steamAppId}.acf`)
}

/**
 * True if `manifestContent` has SteamCMD's documented "StateFlags 6" stuck-error state.
 * Once an update fails, SteamCMD writes this into the manifest and every later run reads
 * it back, aborts immediately without even attempting a download, and reports the exact
 * same failure - regardless of whether the original problem is still there.
 */
export function isManifestStuckInErrorState(manifestContent: string): boolean {
  return /"StateFlags"\s*"6"/.test(manifestContent)
}

/** Deletes the app manifest if it's stuck in the error state above, so the next update can actually run. */
function clearStuckManifest(installDir: string, game: GameId): void {
  const manifestPath = getAppManifestPath(installDir, game)
  if (!fs.existsSync(manifestPath)) return
  if (safeReadFileSync(manifestPath, false, isManifestStuckInErrorState)) {
    fs.rmSync(manifestPath, { force: true })
  }
}

/** SteamCMD's documented appmanifest StateFlags bit for "an update is required". */
const STATE_FLAG_UPDATE_REQUIRED = 2

/**
 * Reads the StateFlags bitmask out of an appmanifest .acf file, or null if it's missing/unparseable.
 */
export function readManifestStateFlags(manifestContent: string): number | null {
  const match = manifestContent.match(/"StateFlags"\s*"(\d+)"/)
  return match ? Number(match[1]) : null
}

/**
 * True once the manifest shows no update is required - i.e. the actual, ground-truth
 * outcome of an update run, independent of the process's own exit code. SteamCMD can
 * relaunch itself mid-run to self-update (seen in the wild: two chained self-updates
 * before it got to the real app_update), and the originally spawned process - the one
 * whose exit code Node tracks - can exit with a stale/misleading non-zero code as part of
 * that relaunch even though the whole chain completes successfully afterwards. Checking
 * the manifest catches that case instead of reporting a false failure.
 */
export function isInstallUpToDate(stateFlags: number | null): boolean {
  return stateFlags !== null && (stateFlags & STATE_FLAG_UPDATE_REQUIRED) === 0
}

function checkInstallUpToDate(installDir: string, game: GameId): boolean {
  const manifestPath = getAppManifestPath(installDir, game)
  if (!fs.existsSync(manifestPath)) return false
  return safeReadFileSync(manifestPath, false, (raw) => isInstallUpToDate(readManifestStateFlags(raw)))
}

/** Reads the installed build id out of an appmanifest .acf file, or null if missing/unparseable. */
export function readManifestBuildId(manifestContent: string): string | null {
  const match = manifestContent.match(/"buildid"\s*"(\d+)"/i)
  return match ? match[1] : null
}

/** The build id currently installed for this profile, or null if it's never been installed. */
export function getInstalledBuildId(installDir: string, game: GameId): string | null {
  const manifestPath = getAppManifestPath(installDir, game)
  if (!fs.existsSync(manifestPath)) return null
  return safeReadFileSync(manifestPath, null, readManifestBuildId)
}

/** A stale/freshly-installed SteamCMD's very first run in a while often has to
 *  self-update before it can do anything else, which tends to fail once (e.g. exit code 7)
 *  before succeeding right after - so a single failure isn't necessarily the real,
 *  final outcome. Retried up to this many attempts before actually surfacing an error. */
const MAX_UPDATE_ATTEMPTS = 3

/** Runs a single SteamCMD update attempt, piping its output into the already-open
 *  `logStream` (left open across retries so the full log shows every attempt). */
function runUpdateAttempt(profile: ServerProfile, steamCmdPath: string, logStream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    clearStuckManifest(profile.installDir, profile.game)

    const args = buildUpdateArgs(profile.installDir, profile.game, {
      enabled: profile.steamBetaEnabled,
      name: profile.steamBetaName
    })
    const previousContentLogSize = contentLogSize(steamCmdPath)

    // Pipe stdout/stderr into a log file instead of 'ignore' - SteamCMD's own console
    // output wasn't surfaced anywhere, making failures undiagnosable beyond the raw exit
    // code. Piping into an actively-draining stream avoids the OS pipe buffer filling up
    // and stalling the process the way leaving it unread would. { end: false } because two
    // sources (stdout and stderr) write into the same destination, and the stream is
    // shared across retries - only the caller closes it once every attempt is done.
    //
    // windowsHide: true - Windows still allocates a console for a console-subsystem child
    // like steamcmd.exe even from a windowless Electron parent; this just keeps it from
    // flashing on screen. (detached: true was tried here too, on the theory SteamCMD needed
    // its own console - it didn't turn out to be the actual fix and left its console window
    // lingering open after steamcmd finished, so it's been dropped.)
    //
    // cwd: steamcmd's own directory - without this the child inherits Electron's working
    // directory, not SteamCMD's. A user-reported fix for the same symptom (works when run
    // manually, fails from a launcher) was specifically to run steamcmd from within its own
    // folder rather than from elsewhere, which this matches.
    const child = spawn(steamCmdPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: path.dirname(steamCmdPath)
    })
    child.stdout?.pipe(logStream, { end: false })
    child.stderr?.pipe(logStream, { end: false })
    child.stdout?.on('data', () => steamcmdUpdateEvents.emit('log', profile.id))
    child.stderr?.on('data', () => steamcmdUpdateEvents.emit('log', profile.id))

    // SteamCMD's piped console output is known to be unreliable on Windows and often
    // carries little to nothing useful - append whatever it wrote to its own persistent
    // content_log.txt since this run started, which tends to have the real detail.
    function finish(): void {
      const newContentLog = readNewContentLog(steamCmdPath, previousContentLogSize)
      if (newContentLog.trim()) {
        logStream.write('\n--- SteamCMD content_log.txt (new since this run) ---\n' + newContentLog)
      }
      steamcmdUpdateEvents.emit('log', profile.id)
    }

    child.on('error', (err) => {
      finish()
      reject(err)
    })

    // 'close' (not 'exit') - it fires only after stdout/stderr have finished emitting all
    // their data, so the piped output is fully written before we append the content_log
    // footer and settle the promise.
    child.on('close', (code) => {
      finish()
      if (code === 0 || checkInstallUpToDate(profile.installDir, profile.game)) {
        resolve()
      } else {
        reject(new Error(describeSteamCmdExitCode(code ?? -1)))
      }
    })
  })
}

/** `skipInProgressGuard`: for a caller (the scheduled restart's post-stop grace delay) that
 *  already reserved the isUpdating lock itself before calling in - without this, the guard
 *  just below would see that self-reserved lock and mistake it for a second, concurrent
 *  update already running. Manual/bulk update callers never pass this, so a real overlapping
 *  update attempt is still rejected as normal. */
export async function updateServer(
  profile: ServerProfile,
  steamCmdPath: string,
  options: { skipInProgressGuard?: boolean } = {}
): Promise<void> {
  if (isRunning(profile.id)) {
    throw new Error('Stop the server before updating it.')
  }
  if (!options.skipInProgressGuard && isUpdating(profile.id)) {
    throw new Error('An update is already running for this server.')
  }
  if (!steamCmdPath.trim()) {
    throw new Error('Set the SteamCMD path in Settings before updating.')
  }
  if (!fs.existsSync(steamCmdPath)) {
    throw new Error(
      `SteamCMD not found at ${steamCmdPath} - it may have been removed (e.g. by ` +
        'reinstalling or updating the Manager itself). Reinstall it via the SteamCMD menu.'
    )
  }

  setUpdating(profile.id, true)
  const logPath = getUpdateLogPath(profile.id)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  const logStream = fs.createWriteStream(logPath)

  try {
    let lastError: Error = new Error('SteamCMD update failed.')
    for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        logStream.write(`\n--- Retrying (attempt ${attempt}/${MAX_UPDATE_ATTEMPTS}) ---\n`)
        steamcmdUpdateEvents.emit('log', profile.id)
      }
      try {
        await runUpdateAttempt(profile, steamCmdPath, logStream)
        return
      } catch (err) {
        lastError = err as Error
      }
    }
    const finalError = new Error(`SteamCMD failed after ${MAX_UPDATE_ATTEMPTS} attempts: ${lastError.message}`)
    logStream.write(`\n--- ${finalError.message} ---\n`)
    steamcmdUpdateEvents.emit('log', profile.id)
    throw finalError
  } finally {
    setUpdating(profile.id, false)
    logStream.end()
  }
}
