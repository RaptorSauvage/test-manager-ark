import type { MinecraftProfile } from '@shared/minecraft'
import { getStatus, emitStatus } from './minecraftProcess'
import { getProcessStats } from './processStats'
import { sendMinecraftRconCommand, parseMinecraftPlayerList } from './minecraftRcon'
import { getMinecraftRconConfig } from './minecraftProperties'

const timers = new Map<string, NodeJS.Timeout>()

export function startMinecraftMonitoring(profile: MinecraftProfile, intervalMs = 5000): void {
  stopMinecraftMonitoring(profile.id)
  const timer = setInterval(() => void tick(profile), intervalMs)
  timers.set(profile.id, timer)
}

async function tick(profile: MinecraftProfile): Promise<void> {
  const status = getStatus(profile.id)
  if (status.state !== 'running' || !status.pid) return

  let stats
  try {
    stats = await getProcessStats(status.pid)
  } catch {
    // The process disappeared between this tick and its own child.on('exit') handler
    // (minecraftProcess.ts) having run yet - just skip this tick, that handler will settle
    // the real state (and stop this monitor, via doStopMinecraftServer's caller) shortly.
    return
  }

  let players = status.players
  let maxPlayers = status.maxPlayers
  // Read fresh from server.properties every tick, same "the user manages this file
  // themselves" philosophy as everywhere else this app reads it - toggling enable-rcon
  // while the server's running takes effect on the very next tick either way.
  if (getMinecraftRconConfig(profile.installDir).enabled) {
    const result = await sendMinecraftRconCommand(profile.installDir, 'list')
    if (result.ok && result.response) {
      const parsed = parseMinecraftPlayerList(result.response)
      players = parsed.players
      maxPlayers = parsed.maxPlayers ?? maxPlayers
    }
  }

  // Re-check: the state may have moved on (stopping/error/etc.) while the above awaited -
  // emitting the stale snapshot captured at the top of this tick would clobber that newer
  // state back to "running".
  const current = getStatus(profile.id)
  if (current.state !== 'running') return

  emitStatus({
    ...current,
    cpu: Math.round(stats.cpu * 10) / 10,
    memoryMB: Math.round(stats.memory / 1024 / 1024),
    players,
    maxPlayers
  })
}

export function stopMinecraftMonitoring(profileId: string): void {
  const timer = timers.get(profileId)
  if (timer) {
    clearInterval(timer)
    timers.delete(profileId)
  }
}
