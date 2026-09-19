import os from 'node:os'
import type { ServerProfile } from '@shared/types'
import { getStatus, emitStatus, markProcessExited, isPidTracked, confirmAliveViaRcon, handleUnexpectedExit } from './serverProcess'
import { listPlayers } from './rcon'
import { getProcessStats } from './processStats'
import { recordStatSample } from './statsHistory'
import { getProfile } from '../store'

const timers = new Map<string, NodeJS.Timeout>()

export function startMonitoring(profile: ServerProfile, intervalMs = 5000): void {
  stopMonitoring(profile.id)
  const timer = setInterval(() => {
    void tick(profile)
  }, intervalMs)
  timers.set(profile.id, timer)
}

/** Refreshes just the player list against whatever the latest status is right now (not a
 *  possibly-stale snapshot from earlier in the calling tick) and re-emits it - used
 *  whenever this tick can't also get a fresh CPU/RAM reading, so a server confirmed alive
 *  over RCON doesn't sit with a stale player list for a whole extra interval on top.
 *  `statsError`, when given, is the raw pidusage failure that led here - surfaced on the
 *  status so a persistent failure (e.g. a missing OS tool) is diagnosable from the UI alone. */
async function refreshPlayersOnly(
  profile: ServerProfile,
  fallbackPlayers: string[] | undefined,
  statsError?: string
): Promise<void> {
  const players = await listPlayers(profile).catch(() => fallbackPlayers ?? [])
  const latest = getStatus(profile.id)
  if (latest.state !== 'running') return
  emitStatus({ ...latest, players, statsError })
}

async function tick(profile: ServerProfile): Promise<void> {
  const status = getStatus(profile.id)
  if (status.state !== 'running' || !status.pid) return

  if (!isPidTracked(profile.id)) {
    // The process we originally spawned exited but RCON confirmed the server itself kept
    // running (see handleUnexpectedExit in serverProcess.ts) - there's no trustworthy pid
    // left for a CPU/RAM reading, so RCON is the only liveness signal available: CPU/RAM
    // just stay at their last known values instead of being reported as 0/gone.
    const stillAlive = await confirmAliveViaRcon(profile, 2, 2000)
    const current = getStatus(profile.id)
    if (current.state !== 'running') return
    if (!stillAlive) {
      stopMonitoring(profile.id)
      markProcessExited(profile.id)
      return
    }
    await refreshPlayersOnly(profile, status.players, status.statsError)
    return
  }

  let stats
  try {
    stats = await getProcessStats(status.pid)
  } catch (err) {
    // A failed read means the tracked OS process is gone - this is the only
    // exit signal we get for a server adopted from a previous app session (no
    // child.on('exit') listener exists for those), and can also race ahead of
    // that listener for one we spawned ourselves. Route through the same
    // RCON-verification safety net as an unexpected child exit before
    // believing the server itself is down.
    const statsError = (err as Error).message
    await handleUnexpectedExit(profile)
    const current = getStatus(profile.id)
    if (current.state !== 'running') {
      stopMonitoring(profile.id)
      return
    }
    // handleUnexpectedExit confirmed the server is still up (whether it re-attached pid
    // tracking to a rediscovered pid, or fell back to degraded mode) - refresh players
    // right away rather than leaving the card stale until the next interval. A fresh
    // CPU/RAM reading, if pid tracking came back, follows naturally on the next tick.
    await refreshPlayersOnly(profile, status.players, statsError)
    return
  }

  const players = await listPlayers(profile).catch(() => status.players ?? [])

  // Re-check: the state may have moved on (stopping/restarting/etc.) while we
  // were awaiting pidusage/RCON above. Emitting the stale snapshot we captured
  // at the top of this tick would clobber that newer state back to "running".
  const current = getStatus(profile.id)
  if (current.state !== 'running') return

  const memoryMB = Math.round(stats.memory / 1024 / 1024)
  const cpu = Math.round(stats.cpu * 10) / 10
  emitStatus({
    ...current,
    cpu,
    memoryMB,
    memoryPercent: Math.round((stats.memory / os.totalmem()) * 1000) / 10,
    players,
    statsError: undefined
  })

  // Re-read from the store rather than trusting the `profile` this monitor loop was
  // started with - that closure is captured once at server-start time, so toggling the
  // Analytics tab's "Enable stats" checkbox on an already-running server would otherwise
  // never take effect until the next start (falls back to the closure's own profile if
  // it isn't in the store at all, e.g. under test).
  if ((getProfile(profile.id) ?? profile).statsEnabled) {
    recordStatSample(profile.id, { time: Date.now(), cpu, memoryMB, players: players.length })
  }
}

export function stopMonitoring(profileId: string): void {
  const timer = timers.get(profileId)
  if (timer) {
    clearInterval(timer)
    timers.delete(profileId)
  }
}
