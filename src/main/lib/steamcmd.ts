import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { ServerProfile } from '@shared/types'
import { setUpdating, isRunning, isUpdating, computeTailReadStart } from './serverProcess'
import { getDataDir } from './dataDir'

/** Steam App ID for the ARK: Survival Ascended dedicated server (free, public - anonymous login works). */
const ARK_ASA_DEDICATED_SERVER_APP_ID = '2430930'

/**
 * Builds the SteamCMD arguments to install/update the dedicated server into
 * `installDir`. Also works for a first-time install into an empty folder.
 */
export function buildUpdateArgs(installDir: string): string[] {
  return [
    '+force_install_dir',
    installDir,
    '+login',
    'anonymous',
    '+app_update',
    ARK_ASA_DEDICATED_SERVER_APP_ID,
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
      'SteamCMD ran out of disk space (exit code 8). ARK: Survival Ascended\'s dedicated server ' +
      'is a large install (30+ GB) - free up space on the drive your install directory is on and try again.'
    )
  }
  return `SteamCMD exited with code ${code}`
}

/** Where the last SteamCMD update run's output is logged for this profile, so failures are diagnosable. */
export function getUpdateLogPath(profileId: string): string {
  return path.join(getDataDir(), 'logs', `steamcmd-update-${profileId}.log`)
}

/** Returns the last update run's log for this profile, or null if it has never been updated. */
export function readUpdateLog(profileId: string): string | null {
  const logPath = getUpdateLogPath(profileId)
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : null
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
  return fs.existsSync(logPath) ? fs.statSync(logPath).size : 0
}

/** Returns only the content_log.txt bytes written since `previousSize`, or '' if there's nothing new. */
export function readNewContentLog(steamCmdPath: string, previousSize: number): string {
  const logPath = getSteamCmdContentLogPath(steamCmdPath)
  if (!fs.existsSync(logPath)) return ''
  const currentSize = fs.statSync(logPath).size
  const readStart = computeTailReadStart(previousSize, currentSize)
  if (readStart === null) return ''
  return fs.readFileSync(logPath).subarray(readStart).toString('utf-8')
}

/** Where SteamCMD tracks this app's install state within a given install directory. */
export function getAppManifestPath(installDir: string): string {
  return path.join(installDir, 'steamapps', `appmanifest_${ARK_ASA_DEDICATED_SERVER_APP_ID}.acf`)
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
function clearStuckManifest(installDir: string): void {
  const manifestPath = getAppManifestPath(installDir)
  if (!fs.existsSync(manifestPath)) return
  if (isManifestStuckInErrorState(fs.readFileSync(manifestPath, 'utf-8'))) {
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

function checkInstallUpToDate(installDir: string): boolean {
  const manifestPath = getAppManifestPath(installDir)
  if (!fs.existsSync(manifestPath)) return false
  return isInstallUpToDate(readManifestStateFlags(fs.readFileSync(manifestPath, 'utf-8')))
}

/** Reads the installed build id out of an appmanifest .acf file, or null if missing/unparseable. */
export function readManifestBuildId(manifestContent: string): string | null {
  const match = manifestContent.match(/"buildid"\s*"(\d+)"/i)
  return match ? match[1] : null
}

/** The build id currently installed for this profile, or null if it's never been installed. */
export function getInstalledBuildId(installDir: string): string | null {
  const manifestPath = getAppManifestPath(installDir)
  if (!fs.existsSync(manifestPath)) return null
  return readManifestBuildId(fs.readFileSync(manifestPath, 'utf-8'))
}

export function updateServer(profile: ServerProfile, steamCmdPath: string): Promise<void> {
  if (isRunning(profile.id)) {
    return Promise.reject(new Error('Stop the server before updating it.'))
  }
  if (isUpdating(profile.id)) {
    return Promise.reject(new Error('An update is already running for this server.'))
  }
  if (!steamCmdPath.trim()) {
    return Promise.reject(new Error('Set the SteamCMD path in Settings before updating.'))
  }
  if (!fs.existsSync(steamCmdPath)) {
    return Promise.reject(
      new Error(
        `SteamCMD not found at ${steamCmdPath} - it may have been removed (e.g. by ` +
          'reinstalling or updating the Manager itself). Reinstall it via the SteamCMD menu.'
      )
    )
  }

  return new Promise((resolve, reject) => {
    clearStuckManifest(profile.installDir)

    const args = buildUpdateArgs(profile.installDir)

    setUpdating(profile.id, true)

    const logPath = getUpdateLogPath(profile.id)
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    const logStream = fs.createWriteStream(logPath)
    const previousContentLogSize = contentLogSize(steamCmdPath)

    // Pipe stdout/stderr into a log file instead of 'ignore' - SteamCMD's own console
    // output wasn't surfaced anywhere, making failures undiagnosable beyond the raw exit
    // code. Piping into an actively-draining stream avoids the OS pipe buffer filling up
    // and stalling the process the way leaving it unread would. { end: false } because two
    // sources (stdout and stderr) write into the same destination - only finish() below
    // should close it, once both are done.
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

    // SteamCMD's piped console output is known to be unreliable on Windows and often
    // carries little to nothing useful - append whatever it wrote to its own persistent
    // content_log.txt since this run started, which tends to have the real detail.
    function finish(): void {
      const newContentLog = readNewContentLog(steamCmdPath, previousContentLogSize)
      if (newContentLog.trim()) {
        logStream.write('\n--- SteamCMD content_log.txt (new since this run) ---\n' + newContentLog)
      }
      logStream.end()
    }

    child.on('error', (err) => {
      setUpdating(profile.id, false)
      finish()
      reject(err)
    })

    // 'close' (not 'exit') - it fires only after stdout/stderr have finished emitting all
    // their data, so the piped output is fully written before we append the content_log
    // footer and settle the promise.
    child.on('close', (code) => {
      setUpdating(profile.id, false)
      finish()
      if (code === 0 || checkInstallUpToDate(profile.installDir)) {
        resolve()
      } else {
        reject(new Error(describeSteamCmdExitCode(code ?? -1)))
      }
    })
  })
}
