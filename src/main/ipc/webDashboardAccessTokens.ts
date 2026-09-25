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
  return { id: token.id, label: token.label, role: token.role, profileIds: token.profileIds, createdAt: token.createdAt }
}

function listSummaries(): WebDashboardAccessTokenSummary[] {
  return listWebDashboardAccessTokens().map(toSummary)
}

/** Access token CRUD - deliberately desktop-only, never exposed over the web dashboard's
 *  own HTTP API, so granting/revoking browser access always requires local access to this
 *  machine. */
export function registerWebDashboardAccessTokensHandlers(): void {
  ipcMain.handle(IPC.webDashboardAccessTokensList, () => listSummaries())

  ipcMain.handle(
    IPC.webDashboardAccessTokensCreate,
    async (_event, label: string, role: WebDashboardRole, profileIds: string[] | null) => {
      const trimmed = label.trim()
      if (!trimmed) throw new Error('Label is required')
      const id = generateApiKeyId()
      const secret = generateApiKeySecret()
      const secretHash = await hashPassword(secret)
      const normalizedProfileIds = profileIds && profileIds.length > 0 ? profileIds : null
      saveWebDashboardAccessToken({
        id,
        label: trimmed,
        secretHash,
        role,
        profileIds: normalizedProfileIds,
        createdAt: Date.now()
      })
      return { token: buildApiKey(id, secret), tokens: listSummaries() }
    }
  )

  ipcMain.handle(
    IPC.webDashboardAccessTokensUpdate,
    (_event, id: string, updates: { label?: string; role?: WebDashboardRole; profileIds?: string[] | null }) => {
      const existing = listWebDashboardAccessTokens().find((t) => t.id === id)
      if (!existing) throw new Error('Unknown access token')
      const label = updates.label !== undefined ? updates.label.trim() : existing.label
      if (!label) throw new Error('Label is required')
      const role = updates.role ?? existing.role
      const profileIds = updates.profileIds !== undefined ? updates.profileIds : existing.profileIds
      const normalizedProfileIds = profileIds && profileIds.length > 0 ? profileIds : null
      saveWebDashboardAccessToken({ ...existing, label, role, profileIds: normalizedProfileIds })
      return listSummaries()
    }
  )

  ipcMain.handle(IPC.webDashboardAccessTokensDelete, (_event, id: string) => {
    return deleteWebDashboardAccessToken(id).map(toSummary)
  })
}
