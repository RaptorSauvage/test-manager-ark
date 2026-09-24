import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { readStatsHistory, readClusterStatsHistory, readClusterStatsHistoryForGroups } from '../lib/statsHistory'

export function registerStatsHistoryHandlers(): void {
  ipcMain.handle(IPC.statsHistoryGet, (_event, profileId: string, sinceMs: number | null, maxPoints?: number) =>
    readStatsHistory(profileId, sinceMs, maxPoints)
  )

  ipcMain.handle(
    IPC.statsHistoryGetForGroup,
    (_event, profileIds: string[], sinceMs: number | null, maxPoints?: number) =>
      readClusterStatsHistory(profileIds, sinceMs, maxPoints)
  )

  ipcMain.handle(
    IPC.statsHistoryGetForGroups,
    (_event, groupProfileIds: Record<string, string[]>, sinceMs: number | null, maxPoints?: number) =>
      readClusterStatsHistoryForGroups(groupProfileIds, sinceMs, maxPoints)
  )
}
