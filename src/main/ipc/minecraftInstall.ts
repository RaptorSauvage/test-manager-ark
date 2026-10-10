import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import type { MinecraftInstallableType, MinecraftInstallParams } from '@shared/minecraftInstall'
import { listInstallableMinecraftVersions, installMinecraftServerFiles } from '../lib/minecraftInstall'

export function registerMinecraftInstallHandlers(): void {
  ipcMain.handle(IPC.minecraftInstallListVersions, (_event, serverType: MinecraftInstallableType) =>
    listInstallableMinecraftVersions(serverType)
  )

  ipcMain.handle(IPC.minecraftInstallRun, (_event, params: MinecraftInstallParams) => installMinecraftServerFiles(params))
}
