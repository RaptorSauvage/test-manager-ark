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
import { readServerProperties, upsertServerPropertiesKeys, type PropertiesData } from '../lib/minecraftProperties'
import { sendMinecraftRconCommand } from '../lib/minecraftRcon'
import { applyMinecraftScheduledRestart, clearMinecraftScheduledRestart } from '../lib/minecraftScheduledActions'
import { applyMinecraftBackupSchedule, clearMinecraftBackupSchedule } from '../lib/minecraftBackupSchedule'
import { openMinecraftServerRootFolder } from '../lib/minecraftBackup'

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

  ipcMain.handle(IPC.minecraftProfilesSave, (_event, profile: MinecraftProfile) => {
    const profiles = saveMinecraftProfile(profile)
    applyMinecraftScheduledRestart(profile)
    applyMinecraftBackupSchedule(profile)
    return profiles
  })

  ipcMain.handle(IPC.minecraftProfilesDelete, (_event, id: string) => {
    clearMinecraftScheduledRestart(id)
    clearMinecraftBackupSchedule(id)
    return deleteMinecraftProfile(id)
  })

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

  ipcMain.handle(IPC.minecraftOpenServerFolder, (_event, profileId: string) => openMinecraftServerRootFolder(requireProfile(profileId)))

  ipcMain.handle(IPC.minecraftServerStart, (_event, profileId: string) => doStartMinecraftServer(requireProfile(profileId)))

  ipcMain.handle(IPC.minecraftServerStop, async (_event, profileId: string) => doStopMinecraftServer(requireProfile(profileId)))

  ipcMain.handle(IPC.minecraftServerKill, (_event, profileId: string) => doKillMinecraftServer(requireProfile(profileId)))

  ipcMain.handle(IPC.minecraftServerStatus, (_event, profileId: string) => getStatus(profileId))

  ipcMain.handle(IPC.minecraftServerSendCommand, async (_event, profileId: string, command: string): Promise<RconResult> => {
    if (sendStdinCommand(profileId, command)) return { ok: true }
    // No live stdin - a server re-adopted from a previous Manager session (see
    // adoptPersistedMinecraftProcesses) has none. RCON is the only other channel available,
    // and only if the server has it enabled.
    const profile = getMinecraftProfile(profileId)
    if (!profile) return { ok: false, error: `Unknown Minecraft profile: ${profileId}` }
    return sendMinecraftRconCommand(profile.installDir, command)
  })

  ipcMain.handle(IPC.minecraftConsoleBacklog, (_event, profileId: string) => getConsoleBacklog(profileId))

  ipcMain.handle(IPC.minecraftPropertiesGet, (_event, profileId: string) => readServerProperties(requireProfile(profileId).installDir))

  ipcMain.handle(IPC.minecraftPropertiesSave, (_event, profileId: string, updates: PropertiesData) => {
    const profile = requireProfile(profileId)
    upsertServerPropertiesKeys(profile.installDir, updates)
    return readServerProperties(profile.installDir)
  })
}
