import type { MinecraftProfile } from '@shared/minecraft'
import { getStatus, emitStatus, isPidTracked } from './minecraftProcess'
import { getProcessStats } from './processStats'
import { sendMinecraftRconCommand, parseMinecraftPlayerList } from './minecraftRcon'
import { getMinecraftRconConfig } from './minecraftProperties'

const timers = new Map<string, NodeJS.Timeout>()
const stopped = new Set<string>()

/** Self-rescheduling (setTimeout, not setInterval) - see monitor.ts's own scheduleNextTick
 *  for the full reasoning (same bug, same fix, same real report): a plain setInterval fires
 *  every intervalMs regardless of whether the previous tick finished, which on Windows meant
 *  overlapping ticks could each spawn their own powershell.exe (getProcessStats) on top of
 *  one(s) still running, turning one slow PowerShell spawn into a compounding pile-up instead
 *  of just a late reading. */
function scheduleNextTick(profile: MinecraftProfile, intervalMs: number): void {
  const timer = setTimeout(() => {
    void tick(profile).finally(() => {
      if (!stopped.has(profile.id)) scheduleNextTick(profile, intervalMs)
    })
  }, intervalMs)
  timers.set(profile.id, timer)
}

export function startMinecraftMonitoring(profile: MinecraftProfile, intervalMs = 5000): void {
  stopMinecraftMonitoring(profile.id)
  stopped.delete(profile.id)
  scheduleNextTick(profile, intervalMs)
}

async function tick(profile: MinecraftProfile): Promise<void> {
  const status = getStatus(profile.id)
  if (status.state !== 'running' || !status.pid) return

  // While pidTracked is false (a Windows launchMode 'script' launch whose real java pid
  // hasn't been found yet - see minecraftProcess.ts's watchForScriptPidHandoff),
  // status.pid is still cmd.exe's own wrapper pid: reading stats off it would show its
  // near-zero CPU/RAM instead of the actual server's, which is exactly the "doesn't match
  // the server" mismatch this guards against. Left undefined below rather than reporting
  // something wrong - the handoff completing on a later tick fills it in correctly.
  let stats: { cpu: number; memory: number } | undefined
  if (isPidTracked(profile.id)) {
    try {
      stats = await getProcessStats(status.pid)
    } catch {
      // The process disappeared between this tick and its own child.on('exit') handler
      // (minecraftProcess.ts) having run yet - just skip this tick, that handler will settle
      // the real state (and stop this monitor, via doStopMinecraftServer's caller) shortly.
      return
    }
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
    ...(stats ? { cpu: Math.round(stats.cpu * 10) / 10, memoryMB: Math.round(stats.memory / 1024 / 1024) } : {}),
    players,
    maxPlayers
  })
}

export function stopMinecraftMonitoring(profileId: string): void {
  stopped.add(profileId)
  const timer = timers.get(profileId)
  if (timer) {
    clearTimeout(timer)
    timers.delete(profileId)
  }
}
