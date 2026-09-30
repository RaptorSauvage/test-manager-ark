import { ipcMain, type WebContents } from 'electron'
import { IPC, type RconResult } from '@shared/types'
import type { MinecraftProfile } from '@shared/minecraft'
import {
  listMinecraftProfiles,
  getMinecraftProfile,
  saveMinecraftProfile,
  deleteMinecraftProfile,
  minecraftProfileEvents
} from '../store'
import { detectMinecraftLaunchable, detectMinecraftProfile, isValidMinecraftInstall } from '../lib/minecraftDetect'
import { getStatus, minecraftServerEvents, sendStdinCommand, getConsoleBacklog, minecraftConsoleEvents } from '../lib/minecraftProcess'
import { doStartMinecraftServer, doStopMinecraftServer, doKillMinecraftServer } from '../lib/minecraftActions'

function requireProfile(profileId: string): MinecraftProfile {
  const profile = getMinecraftProfile(profileId)
  if (!profile) throw new Error(`Unknown Minecraft profile: ${profileId}`)
  return profile
}

export function registerMinecraftHandlers(webContents: WebContents): void {
  minecraftProfileEvents.on('changed', (profiles: MinecraftProfile[]) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.minecraftProfilesChanged, profiles)
  })
  minecraftServerEvents.on('status', (status) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.minecraftServerStatusChanged, status)
  })
  minecraftConsoleEvents.on('line', (profileId: string, line) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.minecraftConsoleLine, profileId, line)
  })

  ipcMain.handle(IPC.minecraftProfilesList, () => listMinecraftProfiles())

  ipcMain.handle(IPC.minecraftProfilesSave, (_event, profile: MinecraftProfile) => saveMinecraftProfile(profile))

  ipcMain.handle(IPC.minecraftProfilesDelete, (_event, id: string) => deleteMinecraftProfile(id))

  // Deliberately does NOT save - the caller (the Settings tab, opened right after) lets the
  // user review/correct every detected field first, same pattern as ARK's profilesImport
  // handler minus the auto-save (see shared/minecraft.ts's import-then-review note).
  ipcMain.handle(IPC.minecraftProfilesImport, (_event, installDir: string) => {
    if (!isValidMinecraftInstall(installDir)) {
      throw new Error('This folder does not look like a set-up Minecraft server (no server.properties, eula.txt, jar, or launch script found).')
    }
    return detectMinecraftProfile(installDir)
  })

  ipcMain.handle(IPC.minecraftDetectLaunchable, (_event, installDir: string) => detectMinecraftLaunchable(installDir))

  ipcMain.handle(IPC.minecraftServerStart, (_event, profileId: string) => doStartMinecraftServer(requireProfile(profileId)))

  ipcMain.handle(IPC.minecraftServerStop, async (_event, profileId: string) => doStopMinecraftServer(requireProfile(profileId)))

  ipcMain.handle(IPC.minecraftServerKill, (_event, profileId: string) => doKillMinecraftServer(requireProfile(profileId)))

  ipcMain.handle(IPC.minecraftServerStatus, (_event, profileId: string) => getStatus(profileId))

  ipcMain.handle(IPC.minecraftServerSendCommand, (_event, profileId: string, command: string): RconResult => {
    const ok = sendStdinCommand(profileId, command)
    return ok ? { ok: true } : { ok: false, error: 'Server is not running, or its console input is not available.' }
  })

  ipcMain.handle(IPC.minecraftConsoleBacklog, (_event, profileId: string) => getConsoleBacklog(profileId))
}
