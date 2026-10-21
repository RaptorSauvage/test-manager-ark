import { Fragment, useEffect, useRef, useState } from 'react'
import type { ServerProfile, FileBrowserEntry, ConfigFileHistorySummary } from '@shared/types'
import type { DiffLine } from '@shared/textDiff'
import { languageForPath, tokenizeLine } from '@shared/syntaxHighlight'
import { confirmAction } from '../../lib/confirmAction'

interface FilesTabProps {
  profile: ServerProfile
}

interface OpenTab {
  path: string
  content: string
  originalContent: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  for (let i = 0; i < units.length; i++) {
    value /= 1024
    if (value < 1024 || i === units.length - 1) return `${value.toFixed(1)} ${units[i]}`
  }
  return `${bytes} B`
}

function isOpenableFileName(name: string): boolean {
  return languageForPath(name) !== 'plain'
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/** Desktop mirror of the web dashboard's own Files tab (same fileBrowser.ts logic
 *  underneath, over IPC instead of HTTP) - browse the install directory, open/delete files,
 *  and edit .ini/.json files (or view .log files read-only) in a Notepad++-inspired tabbed
 *  editor: multiple files open at once, line numbers, Notepad++-style syntax coloring, and a
 *  full-size textarea, with the same history/diff/restore the web version has for .ini/.json
 *  saves. ARK only for now, same scope as the raw .ini editor itself. */
export default function FilesTab({ profile }: FilesTabProps): JSX.Element {
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<FileBrowserEntry[]>([])
  const [listError, setListError] = useState('')

  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [editorError, setEditorError] = useState('')
  const [saving, setSaving] = useState(false)

  const [history, setHistory] = useState<ConfigFileHistorySummary[]>([])
  const [diff, setDiff] = useState<DiffLine[] | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)

  function loadDirectory(dirPath: string): void {
    setListError('')
    window.api.fileBrowser.list(profile.id, dirPath).then(
      (result) => {
        setCurrentPath(result.path)
        setEntries(result.entries)
      },
      (err) => setListError((err as Error).message)
    )
  }

  useEffect(() => {
    loadDirectory('')
    setOpenTabs([])
    setActiveTabPath(null)
    // Only when the server itself changes - loadDirectory is deliberately not a dependency
    // (it's a plain function, recreated every render, re-running this on every render would
    // spam the IPC call).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  function loadHistory(path: string): void {
    window.api.fileBrowser.iniHistory(profile.id, path).then(setHistory).catch(() => setHistory([]))
  }

  function focusTab(path: string): void {
    setActiveTabPath(path)
    setDiff(null)
    setEditorError('')
    loadHistory(path)
  }

  function openFile(entryPath: string): void {
    if (openTabs.some((t) => t.path === entryPath)) {
      focusTab(entryPath)
      return
    }
    setEditorError('')
    window.api.fileBrowser.readIni(profile.id, entryPath).then(
      (content) => {
        setOpenTabs((prev) => [...prev, { path: entryPath, content, originalContent: content }])
        focusTab(entryPath)
      },
      (err) => setEditorError((err as Error).message)
    )
  }

  function closeTab(entryPath: string): void {
    const closedIndex = openTabs.findIndex((t) => t.path === entryPath)
    const next = openTabs.filter((t) => t.path !== entryPath)
    setOpenTabs(next)
    if (activeTabPath === entryPath) {
      const fallback = next[closedIndex] ?? next[closedIndex - 1] ?? null
      if (fallback) focusTab(fallback.path)
      else {
        setActiveTabPath(null)
        setDiff(null)
      }
    }
  }

  function updateActiveTabContent(content: string): void {
    setOpenTabs((prev) => prev.map((t) => (t.path === activeTabPath ? { ...t, content } : t)))
  }

  const activeTab = openTabs.find((t) => t.path === activeTabPath) ?? null
  const isDirty = activeTab ? activeTab.content !== activeTab.originalContent : false
  // .log files open read-only - a running server may still be appending to the same file,
  // and saving stale editor content back over it would silently erase what it wrote since.
  const activeLanguage = activeTab ? languageForPath(activeTab.path) : 'plain'
  const readOnly = activeLanguage === 'log'

  async function saveActiveTab(): Promise<void> {
    if (!activeTab || readOnly) return
    setSaving(true)
    setEditorError('')
    try {
      await window.api.fileBrowser.writeIni(profile.id, activeTab.path, activeTab.content)
      setOpenTabs((prev) => prev.map((t) => (t.path === activeTab.path ? { ...t, originalContent: t.content } : t)))
      loadHistory(activeTab.path)
    } catch (err) {
      setEditorError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function viewDiff(entryId: string): Promise<void> {
    try {
      setDiff(await window.api.fileBrowser.iniHistoryDiff(profile.id, entryId))
    } catch (err) {
      setEditorError((err as Error).message)
    }
  }

  async function restoreEntry(entryId: string): Promise<void> {
    if (!activeTab) return
    if (!confirmAction('Restore this version? The current content will be saved to history first.')) return
    try {
      await window.api.fileBrowser.iniRestore(profile.id, entryId)
      const content = await window.api.fileBrowser.readIni(profile.id, activeTab.path)
      setOpenTabs((prev) => prev.map((t) => (t.path === activeTab.path ? { ...t, content, originalContent: content } : t)))
      setDiff(null)
      loadHistory(activeTab.path)
    } catch (err) {
      setEditorError((err as Error).message)
    }
  }

  async function openInOS(entry: FileBrowserEntry): Promise<void> {
    try {
      await window.api.fileBrowser.open(profile.id, joinPath(currentPath, entry.name))
    } catch (err) {
      setListError((err as Error).message)
    }
  }

  async function deleteEntry(entry: FileBrowserEntry): Promise<void> {
    if (!confirmAction(`Delete "${entry.name}"? This cannot be undone.`)) return
    try {
      await window.api.fileBrowser.delete(profile.id, joinPath(currentPath, entry.name))
      loadDirectory(currentPath)
    } catch (err) {
      setListError((err as Error).message)
    }
  }

  function syncEditorScroll(): void {
    const top = textareaRef.current?.scrollTop ?? 0
    if (gutterRef.current) gutterRef.current.scrollTop = top
    if (highlightRef.current) highlightRef.current.scrollTop = top
  }

  const breadcrumbSegments = currentPath ? currentPath.split('/').filter(Boolean) : []
  const activeLines = activeTab ? activeTab.content.split('\n') : []
  const lineCount = activeLines.length
  const browsing = activeTabPath === null

  const sortedEntries = [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="files-tab">
      <p className="empty-state">
        Browses this server&apos;s own install directory - everything under it, not just configs. Deleting is
        limited to files (not folders) as a safety margin.
      </p>

      {openTabs.length > 0 && (
        <div className="files-open-tabs">
          <button type="button" className={'files-open-tab files-browse-tab' + (browsing ? ' active' : '')} onClick={() => setActiveTabPath(null)}>
            📁 Files
          </button>
          {openTabs.map((tab) => (
            <div key={tab.path} className={'files-open-tab' + (tab.path === activeTabPath ? ' active' : '')}>
              <button type="button" className="files-open-tab-label" onClick={() => focusTab(tab.path)} title={tab.path}>
                {tab.path.split('/').pop()}
                {tab.content !== tab.originalContent ? ' •' : ''}
              </button>
              <button type="button" className="files-open-tab-close" onClick={() => closeTab(tab.path)} title="Close">
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {activeTab ? (
        <div className="files-editor">
          <div className="files-editor-header">
            <h3>
              {activeTab.path}
              {readOnly ? <span className="files-editor-readonly-badge"> (read-only)</span> : null}
            </h3>
            <div className="form-actions">
              {!readOnly && (
                <button type="button" onClick={() => void saveActiveTab()} disabled={saving || !isDirty}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              )}
              <button type="button" onClick={() => closeTab(activeTab.path)}>
                Close
              </button>
            </div>
          </div>
          {editorError && <p className="error-message">{editorError}</p>}
          <div className="files-editor-body">
            <div className="files-editor-gutter" ref={gutterRef}>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <div className="files-editor-code">
              <pre className="files-editor-highlight" ref={highlightRef} aria-hidden="true">
                {activeLines.map((line, i) => (
                  <Fragment key={i}>
                    {tokenizeLine(line, activeLanguage).map((tok, j) => (
                      <span key={j} className={'tok-' + tok.type}>
                        {tok.text}
                      </span>
                    ))}
                    {i < activeLines.length - 1 ? '\n' : null}
                  </Fragment>
                ))}
              </pre>
              <textarea
                ref={textareaRef}
                className="files-editor-textarea"
                value={activeTab.content}
                onChange={(e) => updateActiveTabContent(e.target.value)}
                onScroll={syncEditorScroll}
                readOnly={readOnly}
                spellCheck={false}
              />
            </div>
          </div>

          {!readOnly && (
            <>
              <h4>History</h4>
              {history.length === 0 ? (
                <p className="empty-state">No saved edits yet.</p>
              ) : (
                <ul className="files-ini-history-list">
                  {history.map((entry) => (
                    <li key={entry.id}>
                      <span>{new Date(entry.savedAt).toLocaleString()}</span>
                      <button type="button" onClick={() => void viewDiff(entry.id)}>
                        View diff
                      </button>
                      <button type="button" onClick={() => void restoreEntry(entry.id)}>
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {diff && (
            <div className="files-ini-diff">
              {diff.map((line, i) => (
                <span key={i} className={'diff-' + line.type}>
                  {(line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  ') + line.text}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <nav className="files-breadcrumb">
            <button type="button" onClick={() => loadDirectory('')}>
              Root
            </button>
            {breadcrumbSegments.map((segment, index) => {
              const target = breadcrumbSegments.slice(0, index + 1).join('/')
              return (
                <span key={target}>
                  {' / '}
                  <button type="button" onClick={() => loadDirectory(target)}>
                    {segment}
                  </button>
                </span>
              )
            })}
          </nav>
          {listError && <p className="error-message">{listError}</p>}
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    This folder is empty.
                  </td>
                </tr>
              ) : (
                sortedEntries.map((entry) => (
                  <tr key={entry.name}>
                    <td
                      className={entry.isDir || isOpenableFileName(entry.name) ? 'files-name-cell' : undefined}
                      onClick={() => {
                        if (entry.isDir) loadDirectory(joinPath(currentPath, entry.name))
                        else if (isOpenableFileName(entry.name)) openFile(joinPath(currentPath, entry.name))
                      }}
                    >
                      {entry.isDir ? '📁 ' : '📄 '}
                      {entry.name}
                    </td>
                    <td>{entry.isDir ? '-' : formatFileSize(entry.size)}</td>
                    <td>{new Date(entry.mtime).toLocaleString()}</td>
                    <td>
                      {!entry.isDir && (
                        <>
                          <button type="button" onClick={() => void openInOS(entry)}>
                            Open
                          </button>{' '}
                          <button type="button" className="btn-delete-backup" onClick={() => void deleteEntry(entry)}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
