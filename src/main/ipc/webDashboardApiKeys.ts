import { ipcMain } from 'electron'
import { IPC, type WebDashboardApiKey, type WebDashboardApiKeySummary, type WebDashboardRole } from '@shared/types'
import { listWebDashboardApiKeys, saveWebDashboardApiKey, deleteWebDashboardApiKey } from '../store'
import { hashPassword, generateApiKeyId, generateApiKeySecret, buildApiKey } from '../lib/auth'

function toSummary(key: WebDashboardApiKey): WebDashboardApiKeySummary {
  return { id: key.id, label: key.label, role: key.role, createdAt: key.createdAt }
}

function listSummaries(): WebDashboardApiKeySummary[] {
  return listWebDashboardApiKeys().map(toSummary)
}

/** API key CRUD - deliberately desktop-only, never exposed over the web dashboard's own
 *  HTTP API, so managing which scripts/bots can reach it always requires local access to
 *  this machine. */
export function registerWebDashboardApiKeysHandlers(): void {
  ipcMain.handle(IPC.webDashboardApiKeysList, () => listSummaries())

  ipcMain.handle(IPC.webDashboardApiKeysCreate, async (_event, label: string, role: WebDashboardRole) => {
    const trimmed = label.trim()
    if (!trimmed) throw new Error('Label is required')
    const id = generateApiKeyId()
    const secret = generateApiKeySecret()
    const secretHash = await hashPassword(secret)
    saveWebDashboardApiKey({ id, label: trimmed, secretHash, role, createdAt: Date.now() })
    return { key: buildApiKey(id, secret), keys: listSummaries() }
  })

  ipcMain.handle(IPC.webDashboardApiKeysDelete, (_event, id: string) => {
    return deleteWebDashboardApiKey(id).map(toSummary)
  })
}
