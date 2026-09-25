import { useEffect, useState, type FormEvent } from 'react'
import type { WebDashboardApiKeySummary, WebDashboardRole } from '@shared/types'

const ROLE_LABELS: Record<WebDashboardRole, string> = {
  globalAdmin: 'Global Admin',
  admin: 'Admin',
  moderator: 'Moderator',
  readonly: 'Read-only'
}

const ROLE_OPTIONS: WebDashboardRole[] = ['globalAdmin', 'admin', 'moderator', 'readonly']

function RoleSelect({ role, onChange }: { role: WebDashboardRole; onChange: (role: WebDashboardRole) => void }): JSX.Element {
  return (
    <select value={role} onChange={(e) => onChange(e.target.value as WebDashboardRole)}>
      {ROLE_OPTIONS.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  )
}

/**
 * Web dashboard API keys - for scripts/bots that can't drive a login form/session cookie
 * the way a browser does. Managed only here, from the desktop app's Settings screen, same
 * as accounts. A newly created key's full value is shown exactly once (only its hash is
 * ever stored, so it can't be retrieved again) - lost keys have to be revoked and recreated.
 * An existing key's role can be changed in place (Edit) without touching its secret.
 */
export default function ApiKeysSection(): JSX.Element {
  const [keys, setKeys] = useState<WebDashboardApiKeySummary[]>([])
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<WebDashboardRole>('readonly')
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<WebDashboardRole>('readonly')
  const [editError, setEditError] = useState('')
  const [editBusy, setEditBusy] = useState(false)

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
      if (editingId === id) setEditingId(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function startEdit(key: WebDashboardApiKeySummary): void {
    setEditingId(key.id)
    setEditRole(key.role)
    setEditError('')
  }

  function cancelEdit(): void {
    setEditingId(null)
  }

  async function saveEdit(): Promise<void> {
    if (!editingId) return
    setEditBusy(true)
    setEditError('')
    try {
      setKeys(await window.api.webDashboardApiKeys.update(editingId, { role: editRole }))
      setEditingId(null)
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setEditBusy(false)
    }
  }

  return (
    <section className="accounts-section">
      <h3>Web dashboard API keys</h3>
      <p className="empty-state">
        For scripts/bots that call the web dashboard&apos;s HTTP API directly and can&apos;t log in through a
        browser - send <code>Authorization: Bearer &lt;key&gt;</code> with each request instead of logging in. Only
        matters while &quot;Require access token&quot; above is on; keys grant access per the same roles as the
        access tokens above. API keys aren&apos;t scoped to specific servers, so <strong>Admin</strong> and{' '}
        <strong>Global Admin</strong> behave identically for a key. A key&apos;s role can be changed any time from
        the table below (<strong>Edit</strong>) without invalidating it.
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
        <RoleSelect role={role} onChange={setRole} />
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
            {keys.map((key) =>
              editingId === key.id ? (
                <tr key={key.id} className="accounts-row-editing">
                  <td>{key.label}</td>
                  <td>
                    <RoleSelect role={editRole} onChange={setEditRole} />
                    {editError && <p className="error-message">{editError}</p>}
                  </td>
                  <td className="accounts-row-actions">
                    <button type="button" onClick={() => void saveEdit()} disabled={editBusy}>
                      {editBusy ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" onClick={cancelEdit} disabled={editBusy}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={key.id}>
                  <td>{key.label}</td>
                  <td>{ROLE_LABELS[key.role] ?? key.role}</td>
                  <td className="accounts-row-actions">
                    <button type="button" onClick={() => startEdit(key)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-delete-backup"
                      onClick={() => void handleDelete(key.id, key.label)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </section>
  )
}
