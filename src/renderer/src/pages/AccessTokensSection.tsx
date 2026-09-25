import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ServerProfile, WebDashboardAccessTokenSummary, WebDashboardRole } from '@shared/types'

const ROLE_LABELS: Record<WebDashboardRole, string> = {
  globalAdmin: 'Global Admin',
  admin: 'Admin',
  moderator: 'Moderator',
  readonly: 'Read-only'
}

const ROLE_OPTIONS: WebDashboardRole[] = ['globalAdmin', 'admin', 'moderator', 'readonly']

/**
 * A reusable role + per-server-scope picker - the same two controls used both when creating
 * a token and when editing an existing one's permissions, so the two forms can't drift out
 * of sync with each other.
 */
function RoleAndScopePicker({
  role,
  onRoleChange,
  selectedProfileIds,
  onToggleProfile,
  profiles,
  pickerOpen,
  onTogglePicker,
  pickerRef
}: {
  role: WebDashboardRole
  onRoleChange: (role: WebDashboardRole) => void
  selectedProfileIds: string[]
  onToggleProfile: (id: string) => void
  profiles: ServerProfile[]
  pickerOpen: boolean
  onTogglePicker: () => void
  pickerRef: React.RefObject<HTMLDivElement>
}): JSX.Element {
  function profileName(id: string): string {
    return profiles.find((p) => p.id === id)?.name ?? id
  }

  const pickerSummary =
    selectedProfileIds.length === 0
      ? 'All servers'
      : selectedProfileIds.length === 1
        ? profileName(selectedProfileIds[0])
        : `${selectedProfileIds.length} servers`

  return (
    <>
      <select value={role} onChange={(e) => onRoleChange(e.target.value as WebDashboardRole)}>
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <div className="server-picker" ref={pickerRef}>
        <button type="button" className="server-picker-toggle" disabled={role === 'globalAdmin'} onClick={onTogglePicker}>
          {role === 'globalAdmin' ? 'All servers' : pickerSummary}
          <span className="server-picker-caret">▾</span>
        </button>
        {pickerOpen && role !== 'globalAdmin' && (
          <div className="server-picker-menu">
            {profiles.length === 0 ? (
              <p className="empty-state">No servers yet.</p>
            ) : (
              profiles.map((p) => (
                <label key={p.id} className="checkbox server-picker-option">
                  <input type="checkbox" checked={selectedProfileIds.includes(p.id)} onChange={() => onToggleProfile(p.id)} />
                  {p.name}
                </label>
              ))
            )}
          </div>
        )}
      </div>
    </>
  )
}

/**
 * Web dashboard browser access tokens - what replaces logging in. Pasted once into a
 * browser (stored in that browser's own localStorage, never a cookie/session), then sent
 * back on every request from then on. Managed only here, from the desktop app's Settings
 * screen, never from the dashboard page itself - kept as its own separate list from the
 * API keys below, which are for scripts/bots rather than a person's browser. A newly
 * created token's full value is shown exactly once (only its hash is ever stored, so it
 * can't be retrieved again) - a lost token has to be revoked and recreated. An existing
 * token's role/server scope can be changed in place (Edit) without touching its secret, so
 * changing what a token can do never logs out whoever already has it pasted in.
 */
export default function AccessTokensSection(): JSX.Element {
  const [tokens, setTokens] = useState<WebDashboardAccessTokenSummary[]>([])
  const [profiles, setProfiles] = useState<ServerProfile[]>([])
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<WebDashboardRole>('moderator')
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState('')
  const [newToken, setNewToken] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<WebDashboardRole>('moderator')
  const [editProfileIds, setEditProfileIds] = useState<string[]>([])
  const [editPickerOpen, setEditPickerOpen] = useState(false)
  const [editError, setEditError] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const editPickerRef = useRef<HTMLDivElement>(null)

  function reload(): void {
    window.api.webDashboardAccessTokens.list().then(setTokens)
  }

  useEffect(() => {
    reload()
    window.api.profiles.list().then(setProfiles)
  }, [])

  useEffect(() => {
    if (!pickerOpen) return
    function onOutsideClick(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [pickerOpen])

  useEffect(() => {
    if (!editPickerOpen) return
    function onOutsideClick(e: MouseEvent): void {
      if (editPickerRef.current && !editPickerRef.current.contains(e.target as Node)) setEditPickerOpen(false)
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [editPickerOpen])

  function profileName(id: string): string {
    return profiles.find((p) => p.id === id)?.name ?? id
  }

  function toggleProfileSelected(id: string): void {
    setSelectedProfileIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  async function handleCreate(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    try {
      const { token, tokens: updated } = await window.api.webDashboardAccessTokens.create(
        label,
        role,
        // Global Admin always sees every server regardless of what's checked - enforced
        // server-side too (hasProfileAccess bypasses profileIds for this role), but there's no
        // point persisting a scoping list that will never actually restrict anything.
        role !== 'globalAdmin' && selectedProfileIds.length > 0 ? selectedProfileIds : null
      )
      setTokens(updated)
      setNewToken(token)
      setLabel('')
      setRole('moderator')
      setSelectedProfileIds([])
      setPickerOpen(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleDelete(id: string, targetLabel: string): Promise<void> {
    if (!confirm(`Delete access token "${targetLabel}"? Any browser using it will be logged out immediately.`)) return
    setError('')
    try {
      setTokens(await window.api.webDashboardAccessTokens.delete(id))
      if (editingId === id) setEditingId(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function startEdit(token: WebDashboardAccessTokenSummary): void {
    setEditingId(token.id)
    setEditRole(token.role)
    setEditProfileIds(token.profileIds ?? [])
    setEditPickerOpen(false)
    setEditError('')
  }

  function cancelEdit(): void {
    setEditingId(null)
    setEditPickerOpen(false)
  }

  function toggleEditProfileSelected(id: string): void {
    setEditProfileIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  async function saveEdit(): Promise<void> {
    if (!editingId) return
    setEditBusy(true)
    setEditError('')
    try {
      const updated = await window.api.webDashboardAccessTokens.update(editingId, {
        role: editRole,
        profileIds: editRole !== 'globalAdmin' && editProfileIds.length > 0 ? editProfileIds : null
      })
      setTokens(updated)
      setEditingId(null)
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setEditBusy(false)
    }
  }

  return (
    <section className="accounts-section">
      <h3>Web dashboard access tokens</h3>
      <p className="empty-state">
        Paste one of these into a browser to open the dashboard - there are no accounts or passwords. Only matters
        while &quot;Require access token&quot; above is on. <strong>Global Admin</strong> can do everything,
        including restoring/deleting backups, on every server, regardless of the server picker below.{' '}
        <strong>Admin</strong> can do everything a Global Admin can, but only on the servers this token is
        authorized for. <strong>Moderator</strong> can see and edit Server Management, start/stop/restart servers,
        send RCON commands, and create backups, but can&apos;t change Settings/Mods/Map Management/Update Log or
        restore/delete backups. <strong>Read-only</strong> can only view the Cluster Dashboard and a
        server&apos;s console/players, with no action buttons at all. A token&apos;s role and server scope can be
        changed any time from the table below (<strong>Edit</strong>) without invalidating it.
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
        <RoleAndScopePicker
          role={role}
          onRoleChange={setRole}
          selectedProfileIds={selectedProfileIds}
          onToggleProfile={toggleProfileSelected}
          profiles={profiles}
          pickerOpen={pickerOpen}
          onTogglePicker={() => setPickerOpen((prev) => !prev)}
          pickerRef={pickerRef}
        />
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
            {tokens.map((token) =>
              editingId === token.id ? (
                <tr key={token.id} className="accounts-row-editing">
                  <td>{token.label}</td>
                  <td colSpan={3}>
                    <div className="accounts-row-edit-controls">
                      <RoleAndScopePicker
                        role={editRole}
                        onRoleChange={setEditRole}
                        selectedProfileIds={editProfileIds}
                        onToggleProfile={toggleEditProfileSelected}
                        profiles={profiles}
                        pickerOpen={editPickerOpen}
                        onTogglePicker={() => setEditPickerOpen((prev) => !prev)}
                        pickerRef={editPickerRef}
                      />
                      <button type="button" onClick={() => void saveEdit()} disabled={editBusy}>
                        {editBusy ? 'Saving...' : 'Save'}
                      </button>
                      <button type="button" onClick={cancelEdit} disabled={editBusy}>
                        Cancel
                      </button>
                    </div>
                    {editError && <p className="error-message">{editError}</p>}
                  </td>
                </tr>
              ) : (
                <tr key={token.id}>
                  <td>{token.label}</td>
                  <td>{ROLE_LABELS[token.role] ?? token.role}</td>
                  <td>
                    {token.role !== 'globalAdmin' && token.profileIds && token.profileIds.length > 0
                      ? token.profileIds.map(profileName).join(', ')
                      : 'All'}
                  </td>
                  <td className="accounts-row-actions">
                    <button type="button" onClick={() => startEdit(token)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-delete-backup"
                      onClick={() => void handleDelete(token.id, token.label)}
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
