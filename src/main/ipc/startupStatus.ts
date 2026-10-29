import { ipcMain, type WebContents } from 'electron'
import { IPC } from '@shared/types'
import { isStartupComplete, startupStatusEvents } from '../lib/startupStatus'

export function registerStartupStatusHandlers(webContents: WebContents): void {
  ipcMain.handle(IPC.appStartupStatus, () => isStartupComplete())

  // 'complete' only ever fires once per app lifetime - registered here (during createWindow,
  // near the very start of app.whenReady()) well before main/index.ts reaches the end of its
  // own startup chain and calls markStartupComplete(), so there's no race with the renderer's
  // own query-then-subscribe pattern in appStartup.onComplete missing it.
  startupStatusEvents.once('complete', () => {
    if (!webContents.isDestroyed()) webContents.send(IPC.appStartupStatusChanged)
  })
}
