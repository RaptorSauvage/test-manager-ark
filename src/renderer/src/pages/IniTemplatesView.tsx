import { useEffect, useState } from 'react'
import type { IniTemplateApplyResult, IniTemplateContent, ServerProfile } from '@shared/types'
import { confirmAction } from '../lib/confirmAction'

interface IniTemplatesViewProps {
  profiles: ServerProfile[]
  onBack: () => void
}

const EMPTY_CONTENT: IniTemplateContent = { gameUserSettingsIni: '', gameIni: '' }

interface OverrideFormState {
  profile: ServerProfile
  content: IniTemplateContent
}

/** Tools > INI Templates - a cluster-wide generic GameUserSettings.ini/Game.ini template,
 *  applied as a surgical upsert into each profile's real config files, plus an optional
 *  per-server override appended behind a `;Server Specific INI` marker at the end of the
 *  file so it wins over the generic template (see src/main/lib/iniTemplates.ts). */
export default function IniTemplatesView({ profiles, onBack }: IniTemplatesViewProps): JSX.Element {
  const [generic, setGeneric] = useState<IniTemplateContent>(EMPTY_CONTENT)
  const [loading, setLoading] = useState(true)
  const [savingGeneric, setSavingGeneric] = useState(false)
  const [genericStatus, setGenericStatus] = useState('')
  const [overridesByProfile, setOverridesByProfile] = useState<Record<string, boolean>>({})

  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [applyingAll, setApplyingAll] = useState(false)
  const [applyResults, setApplyResults] = useState<IniTemplateApplyResult[] | null>(null)
  const [applyErrorById, setApplyErrorById] = useState<Record<string, string>>({})
  const [applySuccessId, setApplySuccessId] = useState<string | null>(null)

  const [overrideForm, setOverrideForm] = useState<OverrideFormState | null>(null)
  const [savingOverride, setSavingOverride] = useState(false)
  const [overrideError, setOverrideError] = useState('')

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refresh(): Promise<void> {
    setLoading(true)
    try {
      const [genericContent, overrideFlags] = await Promise.all([
        window.api.iniTemplates.getGeneric(),
        Promise.all(profiles.map(async (p) => [p.id, await window.api.iniTemplates.getOverride(p.id)] as const))
      ])
      setGeneric(genericContent)
      setOverridesByProfile(Object.fromEntries(overrideFlags.map(([id, o]) => [id, o !== null])))
    } finally {
      setLoading(false)
    }
  }

  async function saveGeneric(): Promise<void> {
    setSavingGeneric(true)
    try {
      setGeneric(await window.api.iniTemplates.saveGeneric(generic))
      setGenericStatus('Saved')
      setTimeout(() => setGenericStatus(''), 2000)
    } finally {
      setSavingGeneric(false)
    }
  }

  async function openOverrideForm(profile: ServerProfile): Promise<void> {
    setOverrideError('')
    const existing = await window.api.iniTemplates.getOverride(profile.id)
    setOverrideForm({ profile, content: existing ?? { ...EMPTY_CONTENT } })
  }

  async function saveOverride(): Promise<void> {
    if (!overrideForm) return
    setSavingOverride(true)
    setOverrideError('')
    try {
      await window.api.iniTemplates.saveOverride({ profileId: overrideForm.profile.id, ...overrideForm.content })
      const hasContent = Boolean(overrideForm.content.gameUserSettingsIni.trim() || overrideForm.content.gameIni.trim())
      setOverridesByProfile((prev) => ({ ...prev, [overrideForm.profile.id]: hasContent }))
      setOverrideForm(null)
    } catch (err) {
      setOverrideError((err as Error).message)
    } finally {
      setSavingOverride(false)
    }
  }

  async function clearOverride(): Promise<void> {
    if (!overrideForm) return
    if (
      !confirmAction(
        `Clear ${overrideForm.profile.name}'s override? It'll go back to using only the generic template next time you apply.`
      )
    )
      return
    setSavingOverride(true)
    try {
      await window.api.iniTemplates.deleteOverride(overrideForm.profile.id)
      setOverridesByProfile((prev) => ({ ...prev, [overrideForm.profile.id]: false }))
      setOverrideForm(null)
    } finally {
      setSavingOverride(false)
    }
  }

  async function applyOne(profile: ServerProfile): Promise<void> {
    setApplyingId(profile.id)
    setApplyErrorById((prev) => ({ ...prev, [profile.id]: '' }))
    setApplySuccessId(null)
    try {
      await window.api.iniTemplates.apply(profile.id)
      setApplySuccessId(profile.id)
      setTimeout(() => setApplySuccessId((prev) => (prev === profile.id ? null : prev)), 2500)
    } catch (err) {
      setApplyErrorById((prev) => ({ ...prev, [profile.id]: (err as Error).message }))
    } finally {
      setApplyingId(null)
    }
  }

  async function applyAll(): Promise<void> {
    if (
      !confirmAction(
        "Apply the INI templates to every ARK server? This writes into each one's own GameUserSettings.ini/Game.ini right now."
      )
    )
      return
    setApplyingAll(true)
    setApplyResults(null)
    try {
      setApplyResults(await window.api.iniTemplates.applyAll())
    } finally {
      setApplyingAll(false)
    }
  }

  return (
    <div className="server-detail">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>INI Templates</h1>
        <button
          type="button"
          className="btn-accent ini-templates-apply-all-btn"
          onClick={() => void applyAll()}
          disabled={applyingAll || profiles.length === 0}
        >
          {applyingAll ? 'Applying...' : 'Apply to All'}
        </button>
      </header>
      <p className="empty-state">
        Write a shared base config once, then only the genuinely server-specific lines per server. Applying writes
        the generic template into that server&apos;s real GameUserSettings.ini/Game.ini (a surgical upsert: only the
        keys you&apos;ve actually set are touched, everything else in the file is left alone), then appends the
        server&apos;s own override behind a <code>;Server Specific INI</code> comment at the end of the file so it
        wins. A server&apos;s own name always wins for SessionName, so you never need to set that yourself.
      </p>

      {applyResults && (
        <div className="ini-templates-apply-summary">
          <strong>
            Applied to {applyResults.filter((r) => r.ok).length}/{applyResults.length} server(s)
            {applyResults.some((r) => !r.ok) ? ` - ${applyResults.filter((r) => !r.ok).length} failed` : ''}.
          </strong>
          {applyResults
            .filter((r) => !r.ok)
            .map((r) => (
              <p className="error-message" key={r.profileId}>
                {r.profileName}: {r.error}
              </p>
            ))}
          <button type="button" onClick={() => setApplyResults(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <p className="empty-state">Loading...</p>
      ) : (
        <>
          <section className="cluster-section">
            <h3>Generic Template (every server)</h3>
            <div className="settings-grid">
              <label className="wizard-field">
                GameUserSettings.ini
                <textarea
                  className="ini-template-textarea"
                  value={generic.gameUserSettingsIni}
                  onChange={(e) => setGeneric({ ...generic, gameUserSettingsIni: e.target.value })}
                  placeholder={'[ServerSettings]\nServerPVE=False'}
                  spellCheck={false}
                />
              </label>
              <label className="wizard-field">
                Game.ini
                <textarea
                  className="ini-template-textarea"
                  value={generic.gameIni}
                  onChange={(e) => setGeneric({ ...generic, gameIni: e.target.value })}
                  placeholder={'[/script/shootergame.shootergamemode]\nXPMultiplier=2.0'}
                  spellCheck={false}
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => void saveGeneric()} disabled={savingGeneric}>
                {savingGeneric ? 'Saving...' : 'Save Generic Template'}
              </button>
              {genericStatus && <span className="status-message">{genericStatus}</span>}
            </div>
          </section>

          <section className="cluster-section">
            <h3>Per-Server Overrides</h3>
            {profiles.length === 0 ? (
              <p className="empty-state">No ARK servers yet.</p>
            ) : (
              <table className="map-manager-table">
                <thead>
                  <tr>
                    <th>Server</th>
                    <th>Override</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id}>
                      <td>{profile.name}</td>
                      <td>{overridesByProfile[profile.id] ? 'Yes' : <span className="muted">None</span>}</td>
                      <td className="ini-templates-row-actions">
                        {applyErrorById[profile.id] && <span className="error-message">{applyErrorById[profile.id]}</span>}
                        {applySuccessId === profile.id && <span className="status-message">Applied</span>}
                        <button type="button" onClick={() => void openOverrideForm(profile)}>
                          Edit Override
                        </button>
                        <button type="button" onClick={() => void applyOne(profile)} disabled={applyingId === profile.id}>
                          {applyingId === profile.id ? 'Applying...' : 'Apply'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {overrideForm && (
        <div className="wizard-overlay" onClick={() => !savingOverride && setOverrideForm(null)}>
          <div className="wizard-modal wizard-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="wizard-header">
              <span className="wizard-header-icon">🧩</span>
              <h2>{overrideForm.profile.name} - Override</h2>
              <button type="button" className="wizard-close" onClick={() => setOverrideForm(null)} disabled={savingOverride}>
                ✕
              </button>
            </div>
            <p className="wizard-subtitle">
              These lines are appended behind a <code>;Server Specific INI</code> comment, after the generic
              template, so they win for this one server only.
            </p>
            {overrideError && <p className="error-message">{overrideError}</p>}
            <div className="wizard-body">
              <label className="wizard-field">
                GameUserSettings.ini override
                <textarea
                  className="ini-template-textarea"
                  value={overrideForm.content.gameUserSettingsIni}
                  onChange={(e) =>
                    setOverrideForm({ ...overrideForm, content: { ...overrideForm.content, gameUserSettingsIni: e.target.value } })
                  }
                  spellCheck={false}
                />
              </label>
              <label className="wizard-field">
                Game.ini override
                <textarea
                  className="ini-template-textarea"
                  value={overrideForm.content.gameIni}
                  onChange={(e) => setOverrideForm({ ...overrideForm, content: { ...overrideForm.content, gameIni: e.target.value } })}
                  spellCheck={false}
                />
              </label>
              <div className="wizard-footer">
                <div>
                  <button type="button" className="danger" onClick={() => void clearOverride()} disabled={savingOverride}>
                    Clear Override
                  </button>
                </div>
                <div>
                  <button type="button" onClick={() => setOverrideForm(null)} disabled={savingOverride}>
                    Cancel
                  </button>
                  <button type="button" className="wizard-primary" onClick={() => void saveOverride()} disabled={savingOverride}>
                    {savingOverride ? 'Saving...' : 'Save Override'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
