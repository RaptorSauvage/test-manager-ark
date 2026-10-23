import { ipcMain } from 'electron'
import { IPC, type ModEvent } from '@shared/types'
import { listModEvents, saveModEvent, deleteModEvent, listModEventHistory } from '../store'
import { armModEvent, disarmModEvent } from '../lib/modEvents'

export function registerModEventsHandlers(): void {
  ipcMain.handle(IPC.modEventsList, () => listModEvents())

  ipcMain.handle(IPC.modEventsSave, (_event, modEvent: ModEvent) => {
    const events = saveModEvent(modEvent)
    armModEvent(modEvent)
    return events
  })

  ipcMain.handle(IPC.modEventsDelete, (_event, id: string) => {
    disarmModEvent(id)
    return deleteModEvent(id)
  })

  ipcMain.handle(IPC.modEventsHistoryList, () => listModEventHistory())
}
