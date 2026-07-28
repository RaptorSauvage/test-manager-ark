import os from 'node:os'
import pidusage from 'pidusage'
import type { ServerProfile } from '@shared/types'
import { getStatus, serverEvents, markProcessExited } from './serverProcess'
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

  let stats
  try {
    stats = await pidusage(status.pid)
  } catch {
    // pidusage failing means the OS process is gone - this is the only exit
    // signal we get for a server adopted from a previous app session, and a
    // useful fallback even for one we spawned ourselves this session.
    stopMonitoring(profile.id)
    markProcessExited(profile.id)
    return
  }

  const players = await listPlayers(profile).catch(() => status.players ?? [])

  // Re-check: the state may have moved on (stopping/restarting/etc.) while we
  // were awaiting pidusage/RCON above. Emitting the stale snapshot we captured
  // at the top of this tick would clobber that newer state back to "running".
  const current = getStatus(profile.id)
  if (current.state !== 'running') return

  const memoryMB = Math.round(stats.memory / 1024 / 1024)
  serverEvents.emit('status', {
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
