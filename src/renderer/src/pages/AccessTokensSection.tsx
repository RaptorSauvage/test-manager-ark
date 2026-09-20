import { useEffect, useState, type FormEvent } from 'react'
import type { ServerProfile, WebDashboardAccessTokenSummary, WebDashboardRole } from '@shared/types'

/**
 * Web dashboard browser access tokens - what replaces logging in. Pasted once into a
 * browser (stored in that browser's own localStorage, never a cookie/session), then sent
 * back on every request from then on. Managed only here, from the desktop app's Settings
 * screen, never from the dashboard page itself - kept as its own separate list from the
 * API keys below, which are for scripts/bots rather than a person's browser. A newly
 * created token's full value is shown exactly once (only its hash is ever stored, so it
 * can't be retrieved again) - a lost token has to be revoked and recreated.
 */
export default function AccessTokensSection(): JSX.Element {
  const [tokens, setTokens] = useState<WebDashboardAccessTokenSummary[]>([])
  const [profiles, setProfiles] = useState<ServerProfile[]>([])
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<WebDashboardRole>('operator')
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [newToken, setNewToken] = useState('')

  function reload(): void {
    window.api.webDashboardAccessTokens.list().then(setTokens)
  }

  useEffect(() => {
    reload()
    window.api.profiles.list().then(setProfiles)
  }, [])

  function profileName(id: string): string {
    return profiles.find((p) => p.id === id)?.name ?? id
  }

  async function handleCreate(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    try {
      const { token, tokens: updated } = await window.api.webDashboardAccessTokens.create(
        label,
        role,
        selectedProfileIds.length > 0 ? selectedProfileIds : null
      )
      setTokens(updated)
      setNewToken(token)
      setLabel('')
      setRole('operator')
      setSelectedProfileIds([])
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleDelete(id: string, targetLabel: string): Promise<void> {
    if (!confirm(`Delete access token "${targetLabel}"? Any browser using it will be logged out immediately.`)) return
    setError('')
    try {
      setTokens(await window.api.webDashboardAccessTokens.delete(id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="accounts-section">
      <h3>Web dashboard access tokens</h3>
      <p className="empty-state">
        Paste one of these into a browser to open the dashboard - there are no accounts or passwords. Only matters
        while &quot;Require access token&quot; above is on. <strong>Admin</strong> can do everything including
        restoring/deleting backups. <strong>Operator</strong> can start/stop/restart servers, send RCON commands, and
        create backups, but not restore/delete them. <strong>Read-only</strong> can only view the Cluster Dashboard
        and a server&apos;s console/players, with no action buttons at all.
      </p>

      {newToken && (
        <p className="empty-state">
          <strong>New token (copy it now, it won&apos;t be shown again):</strong>
          <br />
          <code>{newToken}</code>
          <br />
          <button type="button" onClick={() => setNewToken('')}>
            Done
          </button>
        </p>
      )}

      <form className="accounts-add-form" onSubmit={(e) => void handleCreate(e)}>
        <input
          placeholder="Label (e.g. My laptop)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoComplete="off"
        />
        <select value={role} onChange={(e) => setRole(e.target.value as WebDashboardRole)}>
          <option value="admin">Admin</option>
          <option value="operator">Operator</option>
          <option value="readonly">Read-only</option>
        </select>
        <select
          multiple
          className="access-token-server-picker"
          value={selectedProfileIds}
          onChange={(e) => setSelectedProfileIds(Array.from(e.target.selectedOptions, (o) => o.value))}
          title="Ctrl/Cmd-click to select more than one - nothing selected means every server"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="submit">Create token</button>
      </form>
      <p className="empty-state">
        Nothing selected in the server list above gives the token every server, including ones added later.
      </p>
      {error && <p className="error-message">{error}</p>}

      {tokens.length === 0 ? (
        <p className="empty-state">No access tokens yet - create one above before enabling &quot;Require access token&quot;.</p>
      ) : (
        <table className="accounts-table access-tokens-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Role</th>
              <th>Servers</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.id}>
                <td>{token.label}</td>
                <td>{token.role}</td>
                <td>{token.profileIds && token.profileIds.length > 0 ? token.profileIds.map(profileName).join(', ') : 'All'}</td>
                <td className="accounts-row-actions">
                  <button
                    type="button"
                    className="btn-delete-backup"
                    onClick={() => void handleDelete(token.id, token.label)}
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
