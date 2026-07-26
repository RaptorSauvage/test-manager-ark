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
  serverEvents.emit('status', {
    ...status,
    cpu: Math.round(stats.cpu * 10) / 10,
    memoryMB: Math.round(stats.memory / 1024 / 1024),
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
