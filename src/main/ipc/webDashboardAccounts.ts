import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { IPC, type WebDashboardAccount, type WebDashboardAccountSummary, type WebDashboardRole } from '@shared/types'
import { listWebDashboardAccounts, saveWebDashboardAccount, deleteWebDashboardAccount } from '../store'
import { hashPassword } from '../lib/auth'

function toSummary(account: WebDashboardAccount): WebDashboardAccountSummary {
  return { id: account.id, username: account.username, role: account.role }
}

function listSummaries(): WebDashboardAccountSummary[] {
  return listWebDashboardAccounts().map(toSummary)
}

function countAdmins(accounts: WebDashboardAccount[]): number {
  return accounts.filter((a) => a.role === 'admin').length
}

/** Account CRUD - deliberately desktop-only, never exposed over the web dashboard's own
 *  HTTP API, so managing who can log in always requires local access to this machine. */
export function registerWebDashboardAccountsHandlers(): void {
  ipcMain.handle(IPC.webDashboardAccountsList, () => listSummaries())

  ipcMain.handle(IPC.webDashboardAccountsCreate, async (_event, username: string, password: string, role: WebDashboardRole) => {
    const trimmed = username.trim()
    if (!trimmed) throw new Error('Username is required')
    if (!password) throw new Error('Password is required')
    const existing = listWebDashboardAccounts()
    if (existing.some((a) => a.username.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('That username is already taken')
    }
    const passwordHash = await hashPassword(password)
    saveWebDashboardAccount({ id: randomUUID(), username: trimmed, passwordHash, role })
    return listSummaries()
  })

  ipcMain.handle(IPC.webDashboardAccountsSetRole, (_event, id: string, role: WebDashboardRole) => {
    const accounts = listWebDashboardAccounts()
    const account = accounts.find((a) => a.id === id)
    if (!account) throw new Error('Unknown account')
    if (account.role === 'admin' && role !== 'admin' && countAdmins(accounts) <= 1) {
      throw new Error('Cannot demote the last remaining admin account')
    }
    saveWebDashboardAccount({ ...account, role })
    return listSummaries()
  })

  ipcMain.handle(IPC.webDashboardAccountsResetPassword, async (_event, id: string, newPassword: string) => {
    const account = listWebDashboardAccounts().find((a) => a.id === id)
    if (!account) throw new Error('Unknown account')
    if (!newPassword) throw new Error('Password is required')
    const passwordHash = await hashPassword(newPassword)
    saveWebDashboardAccount({ ...account, passwordHash })
    return listSummaries()
  })

  ipcMain.handle(IPC.webDashboardAccountsDelete, (_event, id: string) => {
    const accounts = listWebDashboardAccounts()
    const account = accounts.find((a) => a.id === id)
    if (account && account.role === 'admin' && countAdmins(accounts) <= 1) {
      throw new Error('Cannot delete the last remaining admin account')
    }
    return deleteWebDashboardAccount(id).map(toSummary)
  })
}
