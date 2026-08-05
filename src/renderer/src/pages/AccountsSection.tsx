import { useEffect, useState, type FormEvent } from 'react'
import type { WebDashboardAccountSummary, WebDashboardRole } from '@shared/types'

/**
 * Web dashboard login accounts - managed only here, from the desktop app's Settings
 * screen, never from the dashboard page itself. Each action (add/role change/reset
 * password/delete) saves immediately, matching BackupsTab's pattern rather than the big
 * Settings form's manual Save button, since these aren't part of that form's state.
 */
export default function AccountsSection(): JSX.Element {
  const [accounts, setAccounts] = useState<WebDashboardAccountSummary[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<WebDashboardRole>('operator')
  const [error, setError] = useState('')

  function reload(): void {
    window.api.webDashboardAccounts.list().then(setAccounts)
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleCreate(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    try {
      const updated = await window.api.webDashboardAccounts.create(username, password, role)
      setAccounts(updated)
      setUsername('')
      setPassword('')
      setRole('operator')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleSetRole(id: string, newRole: WebDashboardRole): Promise<void> {
    setError('')
    try {
      setAccounts(await window.api.webDashboardAccounts.setRole(id, newRole))
    } catch (err) {
      setError((err as Error).message)
      reload()
    }
  }

  async function handleResetPassword(id: string, targetUsername: string): Promise<void> {
    const newPassword = prompt(`New password for ${targetUsername}:`)
    if (!newPassword) return
    setError('')
    try {
      setAccounts(await window.api.webDashboardAccounts.resetPassword(id, newPassword))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleDelete(id: string, targetUsername: string): Promise<void> {
    if (!confirm(`Delete account "${targetUsername}"?`)) return
    setError('')
    try {
      setAccounts(await window.api.webDashboardAccounts.delete(id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="accounts-section">
      <h3>Web dashboard accounts</h3>
      <p className="empty-state">
        Accounts for logging into the web dashboard remotely - managed only here, never from the dashboard page
        itself. <strong>Admin</strong> can do everything including restoring/deleting backups.{' '}
        <strong>Operator</strong> can start/stop/restart servers, send RCON commands, and create backups, but not
        restore/delete them. <strong>Read-only</strong> can only view the Cluster Dashboard and a server&apos;s
        console/players, with no action buttons at all.
      </p>

      <form className="accounts-add-form" onSubmit={(e) => void handleCreate(e)}>
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <select value={role} onChange={(e) => setRole(e.target.value as WebDashboardRole)}>
          <option value="admin">Admin</option>
          <option value="operator">Operator</option>
          <option value="readonly">Read-only</option>
        </select>
        <button type="submit">Add account</button>
      </form>
      {error && <p className="error-message">{error}</p>}

      {accounts.length === 0 ? (
        <p className="empty-state">No accounts yet - add one above before enabling &quot;Require login&quot;.</p>
      ) : (
        <table className="accounts-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.username}</td>
                <td>
                  <select
                    value={account.role}
                    onChange={(e) => void handleSetRole(account.id, e.target.value as WebDashboardRole)}
                  >
                    <option value="admin">Admin</option>
                    <option value="operator">Operator</option>
                    <option value="readonly">Read-only</option>
                  </select>
                </td>
                <td className="accounts-row-actions">
                  <button type="button" onClick={() => void handleResetPassword(account.id, account.username)}>
                    Reset password
                  </button>
                  <button
                    type="button"
                    className="btn-delete-backup"
                    onClick={() => void handleDelete(account.id, account.username)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
