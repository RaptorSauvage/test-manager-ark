import { Fragment, useEffect, useState, type FormEvent } from 'react'
import type { ServerProfile, ServerMod, ArkModInfoMap, ArkModSearchResult } from '@shared/types'

interface ModsTabProps {
  profile: ServerProfile
  onProfileChange: (profile: ServerProfile) => void
}

export default function ModsTab({ profile, onProfileChange }: ModsTabProps): JSX.Element {
  const [mods, setMods] = useState<ServerMod[]>(profile.mods)
  const [status, setStatus] = useState('')
  const [newModId, setNewModId] = useState('')
  const [error, setError] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [hasCurseForgeKey, setHasCurseForgeKey] = useState(false)
  const [arkInfo, setArkInfo] = useState<ArkModInfoMap>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ArkModSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState('')
  // ARK: Survival Evolved has neither passive mods nor a -dev suffix - its mods are instead
  // written straight to GameUserSettings.ini/Game.ini (see gameConfigWrite.ts), where every
  // enabled mod counts the same way, full stop. Its own mod ids are Steam Workshop ids too - a
  // completely different namespace from CurseForge's, so the "visual" additions below (search,
  // icon/name enrichment) only make sense for ARK: Survival Ascended and are gated on
  // !isEvolved throughout.
  const isEvolved = profile.game === 'ark-evolved'

  // Picks up any mod already sitting in GameUserSettings.ini's ActiveMods= that the Manager
  // doesn't know about yet - e.g. a server that had mods added by hand-editing the ini, or
  // from before this profile was ever opened here. Additive only (see
  // reconcileAseModsFromIni) - never touches an existing entry, so this can't clobber a
  // deliberately-disabled mod. Re-checks whenever a different server's Mods tab is opened.
  useEffect(() => {
    if (!isEvolved) return
    let cancelled = false
    window.api.mods.reconcileFromIni(profile.id).then((updated) => {
      if (cancelled) return
      if (updated.mods !== profile.mods) {
        const addedCount = updated.mods.length - profile.mods.length
        setMods(updated.mods)
        onProfileChange(updated)
        setStatus(
          `Found ${addedCount} mod${addedCount === 1 ? '' : 's'} already active in GameUserSettings.ini and added ${
            addedCount === 1 ? 'it' : 'them'
          } here.`
        )
        setTimeout(() => setStatus(''), 4000)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, isEvolved])

  useEffect(() => {
    window.api.settings.get().then((settings) => setHasCurseForgeKey(settings.curseforgeApiKey.trim().length > 0))
  }, [])

  // Looks up a real name/icon for every mod id already in the list (typed by hand, or added
  // before this feature existed), not just ones added via the search below - keyed on a
  // sorted/joined id string rather than `mods` itself, so toggling enabled/passive/dev,
  // renaming, or reordering doesn't re-trigger a lookup for a set of ids that hasn't actually
  // changed.
  const modIdsKey = [...mods.map((m) => m.id)].sort().join(',')
  useEffect(() => {
    if (isEvolved || !hasCurseForgeKey || mods.length === 0) {
      setArkInfo({})
      return
    }
    let cancelled = false
    window.api.arkMods
      .info(mods.map((m) => m.id))
      .then((info) => {
        if (!cancelled) setArkInfo(info)
      })
      .catch(() => {
        // Best-effort - a failed background enrichment lookup shouldn't block the rest of the tab.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modIdsKey, isEvolved, hasCurseForgeKey])

  async function persist(next: ServerMod[]): Promise<void> {
    setError('')
    try {
      const updated = await window.api.mods.save(profile.id, next)
      onProfileChange(updated)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function applyMods(next: ServerMod[]): void {
    setMods(next)
    void persist(next)
  }

  function addMod(): void {
    const id = newModId.trim()
    if (!id || mods.some((m) => m.id === id)) return
    applyMods([...mods, { id, enabled: true, passive: false, dev: false }])
    setNewModId('')
  }

  async function handleArkSearch(e: FormEvent): Promise<void> {
    e.preventDefault()
    setSearching(true)
    setSearched(true)
    setSearchError('')
    try {
      const hits = await window.api.arkMods.search(searchQuery)
      setSearchResults(hits)
    } catch (err) {
      setSearchError((err as Error).message)
    } finally {
      setSearching(false)
    }
  }

  // Prefills the real CurseForge name as this new entry's label - unlike addMod's manual path,
  // search already knows it, so there's no reason to make the user retype it. Doesn't touch an
  // already-present mod's own name (addMod/renameMod never did either).
  function addModFromSearch(result: ArkModSearchResult): void {
    if (mods.some((m) => m.id === result.id)) return
    applyMods([...mods, { id: result.id, name: result.name, enabled: true, passive: false, dev: false }])
  }

  function removeMod(id: string): void {
    applyMods(mods.filter((m) => m.id !== id))
  }

  function toggleField(id: string, field: 'enabled' | 'passive' | 'dev'): void {
    applyMods(mods.map((m) => (m.id === id ? { ...m, [field]: !m[field] } : m)))
  }

  function toggleAll(field: 'enabled' | 'passive' | 'dev'): void {
    const allSet = mods.length > 0 && mods.every((m) => m[field])
    applyMods(mods.map((m) => ({ ...m, [field]: !allSet })))
  }

  function renameMod(id: string, name: string): void {
    applyMods(mods.map((m) => (m.id === id ? { ...m, name: name || undefined } : m)))
  }

  // ARK: Survival Ascended's own Name cell - the real CurseForge name once resolved (arkInfo),
  // falling back to whatever label this mod already had (typed in by hand before this feature
  // existed, back when that was the only way to name a row) rather than showing nothing. ARK:
  // Survival Evolved never has CurseForge info at all (see arkInfo's own gating above), so its
  // Name cell stays the editable free-text input it always was - resolvedName is only ever
  // called for an Ascended row.
  function resolvedName(mod: ServerMod): string | undefined {
    return arkInfo[mod.id]?.name ?? mod.name
  }

  function move(index: number, direction: -1 | 1): void {
    const next = [...mods]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    applyMods(next)
  }

  function moveToTop(index: number): void {
    if (index <= 0) return
    const next = [...mods]
    const [moved] = next.splice(index, 1)
    next.unshift(moved)
    applyMods(next)
  }

  async function copyMods(): Promise<void> {
    setError('')
    try {
      // Bare ids, one per line - not the full {id, name, enabled, passive, dev} JSON this used
      // to produce. A mod's real name gets resolved automatically from CurseForge (Ascended)
      // or typed in by hand afterward (Evolved) either way, so there's nothing useful to carry
      // along with the id - and this format can be pasted in from anywhere a mod id list
      // already exists, not just re-imported from this app's own previous export.
      await navigator.clipboard.writeText(mods.map((m) => m.id).join('\n'))
      setStatus('Mod list copied to clipboard.')
      setTimeout(() => setStatus(''), 2000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function importPastedMods(): Promise<void> {
    setError('')
    try {
      const imported = await window.api.mods.parseText(pasteText)
      applyMods(imported)
      setPasteText('')
      setStatus('Mod list imported.')
      setTimeout(() => setStatus(''), 3000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="mods-tab">
      <p>
        {isEvolved ? (
          <>
            Mod IDs, applied in this order. <strong>Enabled</strong> mods are written to
            GameUserSettings.ini&apos;s <code>ActiveMods=</code> and Game.ini&apos;s{' '}
            <code>[ModInstaller]</code> block at the next save - ARK: Survival Evolved has no
            passive/dev mod concept. Any mod id already in <code>ActiveMods=</code> that
            isn&apos;t listed below yet (e.g. added by hand-editing the ini, or from before this
            server was opened here) is picked up automatically when this tab loads. Mod Name is
            just your own label, typed in by hand - not looked up automatically. Changes save
            immediately - restart the server to actually apply them.
          </>
        ) : (
          <>
            Mod IDs, applied in this order. <strong>Enabled</strong> mods are passed via the server&apos;s{' '}
            <code>-mods=</code> launch flag at the next start, unless <strong>Passive</strong> is checked, in
            which case they go via <code>-passivemods=</code> instead. Check <strong>Dev</strong> to load a
            mod&apos;s in-development build (appends <code>-dev</code> to its ID). Name shows each mod&apos;s
            real icon/name resolved from CurseForge once a CurseForge API key is configured - search for a mod
            below to add it by name instead of typing a numeric id by hand. Changes save immediately - restart
            the server to actually apply them.
          </>
        )}
      </p>

      {!isEvolved && (
        <section className="cluster-section ark-mods-search">
          <h3>Search CurseForge</h3>
          {hasCurseForgeKey ? (
            <>
              <p className="empty-state">
                Find a mod by name and add it below - its id and name are filled in for you, instead of hunting
                for a numeric id on CurseForge yourself.
              </p>
              <form className="path-input-row" onSubmit={(e) => void handleArkSearch(e)}>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search ARK: Survival Ascended mods..."
                />
                <button type="submit" disabled={searching || !searchQuery.trim()}>
                  {searching ? 'Searching...' : 'Search'}
                </button>
              </form>
              {searchError && <p className="error-message">{searchError}</p>}
              <div className="ark-mod-search-results">
                {searchResults.map((r) => {
                  const added = mods.some((m) => m.id === r.id)
                  return (
                    <div key={r.id} className="ark-mod-search-result">
                      {r.iconUrl && (
                        <img
                          src={r.iconUrl}
                          alt=""
                          className="ark-mod-icon"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      )}
                      <div className="ark-mod-search-result-info">
                        <span className="ark-mod-search-result-name">{r.name}</span>
                        <span className="muted ark-mod-search-result-summary" title={r.summary}>
                          {r.summary}
                        </span>
                      </div>
                      <span className="muted ark-mod-search-result-downloads">{r.downloads.toLocaleString()} downloads</span>
                      <button type="button" disabled={added} onClick={() => addModFromSearch(r)}>
                        {added ? 'Added' : 'Add'}
                      </button>
                    </div>
                  )
                })}
                {searchResults.length === 0 && (
                  <p className="empty-state">{searched ? 'No results.' : 'Search above to find mods to add.'}</p>
                )}
              </div>
            </>
          ) : (
            <p className="empty-state">
              Set a CurseForge API key in Settings (General) to search for mods by name here instead of typing a
              numeric id by hand - see the README for where to get one.
            </p>
          )}
        </section>
      )}

      <div className="ark-mods-list">
        <div className="mods-add">
          <input
            value={newModId}
            onChange={(e) => setNewModId(e.target.value)}
            placeholder="Mod ID"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addMod()
              }
            }}
          />
          <button onClick={addMod}>Add</button>
        </div>
        <div className={`ark-mods-grid ${isEvolved ? 'ark-mods-grid--evolved' : 'ark-mods-grid--ascended'}`}>
        <div className="ark-mods-grid-header">
          <div className="mods-select-col-header">
            <input
              type="checkbox"
              checked={mods.length > 0 && mods.every((m) => m.enabled)}
              onChange={() => toggleAll('enabled')}
              disabled={mods.length === 0}
              title="Enable all"
            />
            <span>Enable</span>
          </div>
        </div>
        {!isEvolved && (
          <div className="ark-mods-grid-header">
            <div className="mods-select-col-header">
              <input
                type="checkbox"
                checked={mods.length > 0 && mods.every((m) => m.passive)}
                onChange={() => toggleAll('passive')}
                disabled={mods.length === 0}
                title="Mark all as passive"
              />
              <span>Passive</span>
            </div>
          </div>
        )}
        {!isEvolved && (
          <div className="ark-mods-grid-header">
            <div className="mods-select-col-header">
              <input
                type="checkbox"
                checked={mods.length > 0 && mods.every((m) => m.dev)}
                onChange={() => toggleAll('dev')}
                disabled={mods.length === 0}
                title="Mark all as dev"
              />
              <span>Dev</span>
            </div>
          </div>
        )}
        <div className="ark-mods-grid-header">Mod ID</div>
        <div className="ark-mods-grid-header">Name</div>
        <div className="ark-mods-grid-header"></div>
        {mods.map((mod, i) => (
          <Fragment key={mod.id}>
            <div className={`ark-mods-grid-cell ${mod.enabled ? '' : 'mod-disabled'}`}>
              <input type="checkbox" checked={mod.enabled} onChange={() => toggleField(mod.id, 'enabled')} />
            </div>
            {!isEvolved && (
              <div className={`ark-mods-grid-cell ${mod.enabled ? '' : 'mod-disabled'}`}>
                <input type="checkbox" checked={mod.passive} onChange={() => toggleField(mod.id, 'passive')} />
              </div>
            )}
            {!isEvolved && (
              <div className={`ark-mods-grid-cell ${mod.enabled ? '' : 'mod-disabled'}`}>
                <input type="checkbox" checked={mod.dev} onChange={() => toggleField(mod.id, 'dev')} />
              </div>
            )}
            <div className={`ark-mods-grid-cell mod-id ${mod.enabled ? '' : 'mod-disabled'}`}>
              {mod.id}
              {mod.dev ? '-dev' : ''}
            </div>
            <div className={`ark-mods-grid-cell ark-mod-name-cell ${mod.enabled ? '' : 'mod-disabled'}`}>
              {isEvolved ? (
                <input
                  className="mod-name-input"
                  value={mod.name ?? ''}
                  onChange={(e) => renameMod(mod.id, e.target.value)}
                  placeholder="Optional label"
                />
              ) : (
                <>
                  {arkInfo[mod.id]?.iconUrl && (
                    <img
                      src={arkInfo[mod.id].iconUrl}
                      alt=""
                      className="ark-mod-icon"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  )}
                  <span className="ark-mod-title" title={resolvedName(mod)}>
                    {resolvedName(mod) ?? <span className="muted">—</span>}
                  </span>
                </>
              )}
            </div>
            <div className={`ark-mods-grid-cell ark-mods-grid-actions ${mod.enabled ? '' : 'mod-disabled'}`}>
              <button onClick={() => moveToTop(i)} disabled={i === 0} title="Move to top of list">
                ⤒
              </button>
              <button onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button onClick={() => move(i, 1)} disabled={i === mods.length - 1}>
                ↓
              </button>
              <button className="danger" onClick={() => removeMod(mod.id)}>
                Remove
              </button>
            </div>
          </Fragment>
        ))}
        {mods.length === 0 && <div className="ark-mods-grid-empty">No mods configured.</div>}
        </div>
      </div>
      {error && <p className="error-message">{error}</p>}
      {status && (
        <div className="form-actions">
          <span className="status-message">{status}</span>
        </div>
      )}

      <section className="mods-copy-paste">
        <h3>Copy / Paste Mod List</h3>
        <p className="empty-state">
          Copy this server&apos;s current mod ids to share with someone else or keep as a backup, or paste a list
          of mod ids below to replace the mod list above with it - one per line, or separated by commas/spaces.
          Works with a list copied from here, or one found anywhere else (a wiki, a Discord message, a friend&apos;s
          own list){!isEvolved && ' - each mod\'s name is resolved automatically from CurseForge afterward'}.
          Enabled/Passive/Dev reset to their defaults for every imported id.
        </p>
        <div className="form-actions">
          <button type="button" onClick={() => void copyMods()}>
            Copy mod IDs to clipboard
          </button>
        </div>
        <textarea
          className="mods-paste-area"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="Paste a list of mod ids here, one per line..."
          spellCheck={false}
        />
        <div className="form-actions">
          <button type="button" onClick={() => void importPastedMods()} disabled={!pasteText.trim()}>
            Import pasted list
          </button>
        </div>
      </section>
    </div>
  )
}
