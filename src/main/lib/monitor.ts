import os from 'node:os'
import pidusage from 'pidusage'
import type { ServerProfile } from '@shared/types'
import { getStatus, emitStatus, markProcessExited, isPidTracked, confirmAliveViaRcon, handleUnexpectedExit } from './serverProcess'
import { listPlayers } from './rcon'

const timers = new Map<string, NodeJS.Timeout>()

export function startMonitoring(profile: ServerProfile, intervalMs = 5000): void {
  stopMonitoring(profile.id)
  const timer = setInterval(() => {
    void tick(profile)
  }, intervalMs)
  timers.set(profile.id, timer)
}

async function tick(profile: ServerProfile): Promise<void> {
  const status = getStatus(profile.id)
  if (status.state !== 'running' || !status.pid) return

  if (!isPidTracked(profile.id)) {
    // The process we originally spawned exited but RCON confirmed the server itself kept
    // running (see handleUnexpectedExit in serverProcess.ts) - there's no trustworthy pid
    // left for pidusage, so RCON is the only liveness signal available: CPU/RAM just stay
    // at their last known values instead of being reported as 0/gone.
    const stillAlive = await confirmAliveViaRcon(profile, 2, 2000)
    const current = getStatus(profile.id)
    if (current.state !== 'running') return
    if (!stillAlive) {
      stopMonitoring(profile.id)
      markProcessExited(profile.id)
      return
    }
    const players = await listPlayers(profile).catch(() => status.players ?? [])
    emitStatus({ ...current, players })
    return
  }

  let stats
  try {
    stats = await pidusage(status.pid)
  } catch {
    // pidusage failing means the tracked OS process is gone - this is the only
    // exit signal we get for a server adopted from a previous app session (no
    // child.on('exit') listener exists for those), and can also race ahead of
    // that listener for one we spawned ourselves. Route through the same
    // RCON-verification safety net as an unexpected child exit before
    // believing the server itself is down.
    await handleUnexpectedExit(profile)
    if (getStatus(profile.id).state !== 'running') stopMonitoring(profile.id)
    return
  }

  const players = await listPlayers(profile).catch(() => status.players ?? [])

  // Re-check: the state may have moved on (stopping/restarting/etc.) while we
  // were awaiting pidusage/RCON above. Emitting the stale snapshot we captured
  // at the top of this tick would clobber that newer state back to "running".
  const current = getStatus(profile.id)
  if (current.state !== 'running') return

  const memoryMB = Math.round(stats.memory / 1024 / 1024)
  emitStatus({
    ...current,
    cpu: Math.round(stats.cpu * 10) / 10,
    memoryMB,
    memoryPercent: Math.round((stats.memory / os.totalmem()) * 1000) / 10,
    players
  })
}

export function stopMonitoring(profileId: string): void {
  const timer = timers.get(profileId)
  if (timer) {
    clearInterval(timer)
    timers.delete(profileId)
  }
}
