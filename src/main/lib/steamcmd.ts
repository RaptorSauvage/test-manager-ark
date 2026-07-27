import { spawn } from 'node:child_process'
import type { ServerProfile } from '@shared/types'
import { setUpdating, isRunning, isUpdating } from './serverProcess'

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
  return `SteamCMD exited with code ${code}`
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

    // stdio: 'ignore' - SteamCMD's own console output isn't surfaced by this app;
    // leaving the pipes unread would risk the OS buffer filling and stalling it.
    const child = spawn(steamCmdPath, args, { stdio: 'ignore' })

    child.on('error', (err) => {
      setUpdating(profile.id, false)
      reject(err)
    })

    child.on('exit', (code) => {
      setUpdating(profile.id, false)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(describeSteamCmdExitCode(code ?? -1)))
      }
    })
  })
}
