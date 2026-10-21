import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import type { LatestBuildIdCache, ServerProfile } from '@shared/types'
import { type GameId, getGameDefinition, listGameDefinitions } from '@shared/games'
import { getSettings, listProfiles } from '../store'
import { getInstalledBuildId, getDesiredBranchName, PUBLIC_BRANCH } from './steamcmd'

// Keyed by game, then by branch name ("public", or a profile's own steamBetaName) - a
// profile pinned to a beta branch has its own "latest build id" entirely separate from the
// public branch's, so one cache slot per game alone isn't enough: it made every beta-pinned
// server see the public branch's build id as "latest" and show "update available" forever,
// even while fully up to date on its own branch.
let cache: Partial<Record<GameId, Record<string, LatestBuildIdCache>>> = {}
let pollTimer: NodeJS.Timeout | null = null

/**
 * Pulls the "buildid" out of `branches { <branch> { buildid "..." } }` in the text SteamCMD's
 * `app_info_print` prints (a VDF/KeyValues dump, not JSON - regex is good enough here, same
 * approach already used for the installed appmanifest .acf, which is the same format).
 */
export function parseBranchBuildId(appInfoOutput: string, branch: string = PUBLIC_BRANCH): string | null {
  const branchesIndex = appInfoOutput.indexOf('"branches"')
  if (branchesIndex === -1) return null
  const branchIndex = appInfoOutput.indexOf(`"${branch}"`, branchesIndex)
  if (branchIndex === -1) return null
  const match = appInfoOutput.slice(branchIndex, branchIndex + 500).match(/"buildid"\s*"(\d+)"/)
  return match ? match[1] : null
}

/**
 * SteamCMD caches the whole `app_info_print` dump locally (`appcache/appinfo.vdf`, next to
 * steamcmd.exe itself) and `+app_info_update 1` only best-effort *requests* a refresh of it -
 * it doesn't block until that refresh actually lands before the following `+app_info_print`
 * reads the cache back. For the "public" branch (queried constantly by everyone using this
 * app id) that cache is practically always warm/current, so this never showed up - but a
 * less-queried branch (a beta/PTR one, queried only by profiles actually pinned to it) can
 * sit on a stale cached buildid indefinitely, well behind what `+app_update -beta <branch>`
 * itself resolves to (that command always negotiates fresh with Steam's CDN, cache or not) -
 * a real report found exactly this: a PTR-pinned server kept showing "update available"
 * forever despite `+app_update` itself confirming nothing had changed. Deleting the cache
 * file first forces SteamCMD to fetch it from scratch instead of trusting whatever's on disk.
 */
export function clearAppInfoCache(steamCmdPath: string): void {
  const appInfoPath = path.join(path.dirname(steamCmdPath), 'appcache', 'appinfo.vdf')
  try {
    if (fs.existsSync(appInfoPath)) fs.rmSync(appInfoPath, { force: true })
  } catch {
    // Best-effort - a failed delete just leaves this one poll as exposed to the staleness
    // above as it always was before this fix; not worth failing the whole check over.
  }
}

/**
 * Asks SteamCMD (anonymous login, no download) for `game`'s current build id on `branch` -
 * the same id `getInstalledBuildId` reads out of an install's own manifest once it's actually
 * installed, so the two are directly comparable for an "update available" check without ever
 * hitting a third-party site like SteamDB (fragile to scrape, and not an endpoint Valve
 * documents/supports for this).
 */
export function checkLatestBuildId(steamCmdPath: string, game: GameId, branch: string = PUBLIC_BRANCH): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!steamCmdPath.trim() || !fs.existsSync(steamCmdPath)) {
      reject(new Error('SteamCMD path is not set or does not exist - set it in Settings first.'))
      return
    }

    clearAppInfoCache(steamCmdPath)

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
    // "branches"/"<branch>"/"buildid" section this looks for - the same race already found
    // and fixed in steamcmd.ts's own update-download child process.
    child.on('close', () => {
      const buildId = parseBranchBuildId(output, branch)
      if (buildId) resolve(buildId)
      else reject(new Error(`Could not find a "${branch}" branch build id in SteamCMD's app_info_print output.`))
    })
  })
}

export function getLatestBuildIdCache(game: GameId, branch: string = PUBLIC_BRANCH): LatestBuildIdCache {
  return cache[game]?.[branch] ?? { buildId: null, checkedAt: null, error: null }
}

function setLatestBuildIdCache(game: GameId, branch: string, value: LatestBuildIdCache): void {
  cache[game] = { ...cache[game], [branch]: value }
}

/** Pure comparison, split out from isUpdateAvailableForProfile below so it's testable without
 *  needing a real SteamCMD poll or a real installed manifest on disk - false whenever either
 *  side is unknown (never polled yet, or never installed), same as "unknown" meaning "don't
 *  restart" rather than "go ahead" in isUpdateAvailableForProfile's own doc comment. */
export function isUpdateAvailable(installedBuildId: string | null, latestBuildId: string | null): boolean {
  return latestBuildId !== null && installedBuildId !== null && installedBuildId !== latestBuildId
}

/**
 * Same comparison UpdateCheckPanel.tsx already does in the renderer (cached latest SteamCMD
 * build id vs. this profile's own installed build id, from its appmanifest .acf), but
 * available in the main process too - for runScheduledRestart's "only if an update is
 * available" condition (scheduledActions.ts), which can't reach into the renderer. False
 * whenever either side is unknown (never polled yet, never installed, or this profile's game
 * doesn't support update checking at all, e.g. ARK: Survival Evolved) - unlike
 * "only if empty", there's no live RCON question to ask here, so "unknown" has to mean "don't
 * restart" rather than "go ahead", since proceeding on a false positive is the one direction
 * that can't be undone by just waiting for the next occurrence.
 */
export function isUpdateAvailableForProfile(profile: ServerProfile): boolean {
  if (!getGameDefinition(profile.game).supportsUpdateCheck) return false
  const branch = getDesiredBranchName(profile)
  const latestBuildId = getLatestBuildIdCache(profile.game, branch).buildId
  // Short-circuits before touching disk at all when nothing's been polled yet (the common
  // case right after the Manager starts) - no point reading the installed manifest just to
  // immediately discard it.
  if (!latestBuildId) return false
  return isUpdateAvailable(getInstalledBuildId(profile.installDir, profile.game), latestBuildId)
}

async function pollOnceForGame(game: GameId, branch: string): Promise<void> {
  try {
    const buildId = await checkLatestBuildId(getSettings().steamCmdPath, game, branch)
    setLatestBuildIdCache(game, branch, { buildId, checkedAt: Date.now(), error: null })
  } catch (err) {
    setLatestBuildIdCache(game, branch, {
      ...getLatestBuildIdCache(game, branch),
      checkedAt: Date.now(),
      error: (err as Error).message
    })
  }
}

/** Every (game, branch) pair actually worth polling: the public branch for every SteamCMD
 *  game that supports update checking (so a server not yet on a beta still gets a check),
 *  plus whichever beta branch any configured profile is actually pinned to - a beta branch
 *  nobody has a profile on isn't polled, since there'd be nothing to compare it against. */
function activeBranchesToPoll(): Array<{ game: GameId; branch: string }> {
  const pairs = new Map<string, { game: GameId; branch: string }>()
  for (const g of listGameDefinitions().filter((g) => g.usesSteamCmd && g.supportsUpdateCheck)) {
    pairs.set(`${g.id}\u0000${PUBLIC_BRANCH}`, { game: g.id, branch: PUBLIC_BRANCH })
  }
  for (const profile of listProfiles()) {
    const def = getGameDefinition(profile.game)
    if (!def.usesSteamCmd || !def.supportsUpdateCheck) continue
    const branch = getDesiredBranchName(profile)
    pairs.set(`${profile.game}\u0000${branch}`, { game: profile.game, branch })
  }
  return Array.from(pairs.values())
}

/** Exported for tests - startUpdateCheckPolling below only ever fire-and-forgets this, so a
 *  test needs a way to await one poll pass directly and then inspect getLatestBuildIdCache. */
export async function pollOnce(): Promise<void> {
  await Promise.all(activeBranchesToPoll().map(({ game, branch }) => pollOnceForGame(game, branch)))
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
