import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { ServerProfile } from '@shared/types'
import { setUpdating, isRunning, isUpdating } from './serverProcess'
import { getManagerBaseDir } from './steamcmdInstaller'

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
  return path.join(getManagerBaseDir(), 'logs', `steamcmd-update-${profileId}.log`)
}

/** Returns the last update run's log for this profile, or null if it has never been updated. */
export function readUpdateLog(profileId: string): string | null {
  const logPath = getUpdateLogPath(profileId)
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : null
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

  return new Promise((resolve, reject) => {
    const args = buildUpdateArgs(profile.installDir)

    setUpdating(profile.id, true)

    const logPath = getUpdateLogPath(profile.id)
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    const logStream = fs.createWriteStream(logPath)

    // Pipe stdout/stderr into a log file instead of 'ignore' - SteamCMD's own console
    // output wasn't surfaced anywhere, making failures (like exit code 7) undiagnosable
    // beyond the raw code. Piping into an actively-draining stream avoids the OS pipe
    // buffer filling up and stalling the process the way leaving it unread would.
    const child = spawn(steamCmdPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout?.pipe(logStream)
    child.stderr?.pipe(logStream)

    child.on('error', (err) => {
      setUpdating(profile.id, false)
      logStream.end()
      reject(err)
    })

    child.on('exit', (code) => {
      setUpdating(profile.id, false)
      logStream.end()
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(describeSteamCmdExitCode(code ?? -1)))
      }
    })
  })
}
