import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import type { LatestBuildIdCache } from '@shared/types'
import { type GameId, getGameDefinition, listGameDefinitions } from '@shared/games'
import { getSettings } from '../store'

let cache: Partial<Record<GameId, LatestBuildIdCache>> = {}
let pollTimer: NodeJS.Timeout | null = null

/**
 * Pulls the "buildid" out of `branches { public { buildid "..." } }` in the text SteamCMD's
 * `app_info_print` prints (a VDF/KeyValues dump, not JSON - regex is good enough here, same
 * approach already used for the installed appmanifest .acf, which is the same format).
 * Only "public" is read - a server profile pinned to a beta branch isn't tracked by this app.
 */
export function parseLatestPublicBuildId(appInfoOutput: string): string | null {
  const branchesIndex = appInfoOutput.indexOf('"branches"')
  if (branchesIndex === -1) return null
  const publicIndex = appInfoOutput.indexOf('"public"', branchesIndex)
  if (publicIndex === -1) return null
  const match = appInfoOutput.slice(publicIndex, publicIndex + 500).match(/"buildid"\s*"(\d+)"/)
  return match ? match[1] : null
}

/**
 * Asks SteamCMD (anonymous login, no download) for `game`'s current public-branch build id -
 * the same id `getInstalledBuildId` reads out of an install's own manifest once it's actually
 * installed, so the two are directly comparable for an "update available" check without ever
 * hitting a third-party site like SteamDB (fragile to scrape, and not an endpoint Valve
 * documents/supports for this).
 */
export function checkLatestBuildId(steamCmdPath: string, game: GameId): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!steamCmdPath.trim() || !fs.existsSync(steamCmdPath)) {
      reject(new Error('SteamCMD path is not set or does not exist - set it in Settings first.'))
      return
    }

    const args = [
      '+login',
      'anonymous',
      '+app_info_update',
      '1',
      '+app_info_print',
      getGameDefinition(game).steamAppId,
      '+quit'
    ]
    const child = spawn(steamCmdPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: path.dirname(steamCmdPath)
    })

    let output = ''
    child.stdout?.on('data', (chunk) => (output += chunk))
    child.stderr?.on('data', (chunk) => (output += chunk))

    child.on('error', reject)
    // 'close' (not 'exit') - it fires only after stdout/stderr have finished emitting all
    // their data, so app_info_print's (fairly large) VDF dump is fully captured in `output`
    // before parsing it. 'exit' can fire first and race ahead of the last chunk(s) of
    // stdout arriving, which intermittently truncated the output right before the
    // "branches"/"public"/"buildid" section this looks for - the same race already found
    // and fixed in steamcmd.ts's own update-download child process.
    child.on('close', () => {
      const buildId = parseLatestPublicBuildId(output)
      if (buildId) resolve(buildId)
      else reject(new Error("Could not find a public branch build id in SteamCMD's app_info_print output."))
    })
  })
}

export function getLatestBuildIdCache(game: GameId): LatestBuildIdCache {
  return cache[game] ?? { buildId: null, checkedAt: null, error: null }
}

async function pollOnceForGame(game: GameId): Promise<void> {
  try {
    const buildId = await checkLatestBuildId(getSettings().steamCmdPath, game)
    cache[game] = { buildId, checkedAt: Date.now(), error: null }
  } catch (err) {
    cache[game] = { ...getLatestBuildIdCache(game), checkedAt: Date.now(), error: (err as Error).message }
  }
}

async function pollOnce(): Promise<void> {
  await Promise.all(
    listGameDefinitions()
      .filter((g) => g.usesSteamCmd && g.supportsUpdateCheck)
      .map((g) => pollOnceForGame(g.id))
  )
}

/** Starts polling SteamCMD for every SteamCMD-based game's latest dedicated server build id,
 *  immediately and then every `intervalMs` (default 30 minutes). Returns a function that
 *  stops polling. */
export function startUpdateCheckPolling(intervalMs = 30 * 60 * 1000): () => void {
  void pollOnce()
  pollTimer = setInterval(() => void pollOnce(), intervalMs)
  return () => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
  }
}
