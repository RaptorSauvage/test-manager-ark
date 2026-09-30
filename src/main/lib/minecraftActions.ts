import type { MinecraftProfile, MinecraftServerStatus } from '@shared/minecraft'
import { startServer, stopServer, killServer } from './minecraftProcess'
import { startMinecraftMonitoring, stopMinecraftMonitoring } from './minecraftMonitor'
import { logManagerEvent, newTaskId } from './managerLog'

/** Orchestration for the Minecraft IPC handlers - mirrors serverActions.ts's role for ARK:
 *  keeps "start"/"stop"/"kill" meaning "the process itself, plus the CPU/RAM/player monitor,
 *  plus a Manager Log entry" in one place rather than repeating all three at every call site. */

export function doStartMinecraftServer(profile: MinecraftProfile): MinecraftServerStatus {
  const status = startServer(profile)
  startMinecraftMonitoring(profile)
  logManagerEvent(newTaskId('mc-start'), `Start — ${profile.name}`, 'Started')
  return status
}

export async function doStopMinecraftServer(profile: MinecraftProfile): Promise<MinecraftServerStatus> {
  stopMinecraftMonitoring(profile.id)
  const status = await stopServer(profile)
  logManagerEvent(newTaskId('mc-stop'), `Stop — ${profile.name}`, 'Stopped')
  return status
}

export function doKillMinecraftServer(profile: MinecraftProfile): MinecraftServerStatus {
  stopMinecraftMonitoring(profile.id)
  const status = killServer(profile.id)
  logManagerEvent(newTaskId('mc-kill'), `Kill — ${profile.name}`, 'Killed')
  return status
}
