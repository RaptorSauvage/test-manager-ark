import { spawn } from 'node:child_process'
import type { ServerProfile } from '@shared/types'
import { emitLog, setUpdating, isRunning, isUpdating } from './serverProcess'

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
    emitLog({
      profileId: profile.id,
      stream: 'system',
      line: `Starting SteamCMD update (app ${ARK_ASA_DEDICATED_SERVER_APP_ID})...`,
      timestamp: Date.now()
    })

    const child = spawn(steamCmdPath, args)

    child.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/).filter(Boolean)) {
        emitLog({ profileId: profile.id, stream: 'stdout', line, timestamp: Date.now() })
      }
    })
    child.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/).filter(Boolean)) {
        emitLog({ profileId: profile.id, stream: 'stderr', line, timestamp: Date.now() })
      }
    })

    child.on('error', (err) => {
      setUpdating(profile.id, false)
      reject(err)
    })

    child.on('exit', (code) => {
      setUpdating(profile.id, false)
      if (code === 0) {
        emitLog({
          profileId: profile.id,
          stream: 'system',
          line: 'SteamCMD update finished successfully.',
          timestamp: Date.now()
        })
        resolve()
      } else {
        const message = `SteamCMD exited with code ${code}`
        emitLog({ profileId: profile.id, stream: 'system', line: message, timestamp: Date.now() })
        reject(new Error(message))
      }
    })
  })
}
