import { useEffect, useState, type FormEvent } from 'react'
import type { WebDashboardApiKeySummary, WebDashboardRole } from '@shared/types'

/**
 * Web dashboard API keys - for scripts/bots that can't drive a login form/session cookie
 * the way a browser does. Managed only here, from the desktop app's Settings screen, same
 * as accounts. A newly created key's full value is shown exactly once (only its hash is
 * ever stored, so it can't be retrieved again) - lost keys have to be revoked and recreated.
 */
export default function ApiKeysSection(): JSX.Element {
  const [keys, setKeys] = useState<WebDashboardApiKeySummary[]>([])
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<WebDashboardRole>('readonly')
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState('')

  function reload(): void {
    window.api.webDashboardApiKeys.list().then(setKeys)
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleCreate(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    try {
      const { key, keys: updated } = await window.api.webDashboardApiKeys.create(label, role)
      setKeys(updated)
      setNewKey(key)
      setLabel('')
      setRole('readonly')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleDelete(id: string, targetLabel: string): Promise<void> {
    if (!confirm(`Delete API key "${targetLabel}"? Anything using it will stop working immediately.`)) return
    setError('')
    try {
      setKeys(await window.api.webDashboardApiKeys.delete(id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="accounts-section">
      <h3>Web dashboard API keys</h3>
      <p className="empty-state">
        For scripts/bots that call the web dashboard&apos;s HTTP API directly and can&apos;t log in through a
        browser - send <code>Authorization: Bearer &lt;key&gt;</code> with each request instead of logging in. Only
        matters while &quot;Require login&quot; above is on; keys grant access per the same three roles as accounts.
      </p>

      {newKey && (
        <p className="empty-state">
          <strong>New key (copy it now, it won&apos;t be shown again):</strong>
          <br />
          <code>{newKey}</code>
          <br />
          <button type="button" onClick={() => setNewKey('')}>
            Done
          </button>
        </p>
      )}

      <form className="accounts-add-form" onSubmit={(e) => void handleCreate(e)}>
        <input
          placeholder="Label (e.g. Discord bot)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoComplete="off"
        />
        <select value={role} onChange={(e) => setRole(e.target.value as WebDashboardRole)}>
          <option value="admin">Admin</option>
          <option value="operator">Operator</option>
          <option value="readonly">Read-only</option>
        </select>
        <button type="submit">Create key</button>
      </form>
      {error && <p className="error-message">{error}</p>}

      {keys.length === 0 ? (
        <p className="empty-state">No API keys yet.</p>
      ) : (
        <table className="accounts-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td>{key.label}</td>
                <td>{key.role}</td>
                <td className="accounts-row-actions">
                  <button
                    type="button"
                    className="btn-delete-backup"
                    onClick={() => void handleDelete(key.id, key.label)}
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
