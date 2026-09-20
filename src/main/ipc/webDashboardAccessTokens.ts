import { ipcMain } from 'electron'
import {
  IPC,
  type WebDashboardAccessToken,
  type WebDashboardAccessTokenSummary,
  type WebDashboardRole
} from '@shared/types'
import { listWebDashboardAccessTokens, saveWebDashboardAccessToken, deleteWebDashboardAccessToken } from '../store'
import { hashPassword, generateApiKeyId, generateApiKeySecret, buildApiKey } from '../lib/auth'

function toSummary(token: WebDashboardAccessToken): WebDashboardAccessTokenSummary {
  return { id: token.id, label: token.label, role: token.role, createdAt: token.createdAt }
}

function listSummaries(): WebDashboardAccessTokenSummary[] {
  return listWebDashboardAccessTokens().map(toSummary)
}

/** Access token CRUD - deliberately desktop-only, never exposed over the web dashboard's
 *  own HTTP API, so granting/revoking browser access always requires local access to this
 *  machine. */
export function registerWebDashboardAccessTokensHandlers(): void {
  ipcMain.handle(IPC.webDashboardAccessTokensList, () => listSummaries())

  ipcMain.handle(IPC.webDashboardAccessTokensCreate, async (_event, label: string, role: WebDashboardRole) => {
    const trimmed = label.trim()
    if (!trimmed) throw new Error('Label is required')
    const id = generateApiKeyId()
    const secret = generateApiKeySecret()
    const secretHash = await hashPassword(secret)
    saveWebDashboardAccessToken({ id, label: trimmed, secretHash, role, createdAt: Date.now() })
    return { token: buildApiKey(id, secret), tokens: listSummaries() }
  })

  ipcMain.handle(IPC.webDashboardAccessTokensDelete, (_event, id: string) => {
    return deleteWebDashboardAccessToken(id).map(toSummary)
  })
}
