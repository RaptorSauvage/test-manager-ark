import pidusage from 'pidusage'
import type { ServerProfile } from '@shared/types'
import { getStatus, serverEvents } from './serverProcess'
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

  try {
    const [stats, players] = await Promise.all([pidusage(status.pid), listPlayers(profile)])
    serverEvents.emit('status', {
      ...status,
      cpu: Math.round(stats.cpu * 10) / 10,
      memoryMB: Math.round(stats.memory / 1024 / 1024),
      players
    })
  } catch {
    // Process may have exited between the status check and the stats call - ignore this tick.
  }
}

export function stopMonitoring(profileId: string): void {
  const timer = timers.get(profileId)
  if (timer) {
    clearInterval(timer)
    timers.delete(profileId)
  }
}
