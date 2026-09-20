import { useEffect, useRef, useState } from 'react'
import type { ManagerLogEntry } from '@shared/types'

interface TaskGroup {
  taskId: string
  taskLabel: string
  entries: ManagerLogEntry[]
}

/** taskId prefixes (see newTaskId in src/main/lib/managerLog.ts) mapped to a display
 *  category, longest/most-specific prefix first so e.g. "scheduled-restart-..." matches
 *  before a hypothetical plain "restart-" check would. Purely a display concern - an
 *  unrecognized prefix (including any historical log entries predating this) just renders
 *  uncolored instead of failing to render. */
const CATEGORY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['scheduled-restart-', 'schedule'],
  ['crash-watch-', 'crash'],
  ['backup-', 'backup'],
  ['restore-', 'restore'],
  ['update-', 'update'],
  ['start-', 'start'],
  ['stop-', 'stop'],
  ['restart-', 'restart'],
  ['kill-', 'kill']
]

function categoryForTaskId(taskId: string): string | null {
  const found = CATEGORY_PREFIXES.find(([prefix]) => taskId.startsWith(prefix))
  return found ? found[1] : null
}

/** Groups a chronological list of entries into consecutive runs sharing the same taskId -
 *  a single manual action (Start/Stop/Kill/Restart) is a "group" of exactly one entry, while
 *  a scheduled restart or a backup's several steps land together under one header instead of
 *  reading as unrelated lines. Entries always arrive in append order (see managerLog.ts),
 *  so no re-sorting is needed here. */
function groupByTask(entries: ManagerLogEntry[]): TaskGroup[] {
  const groups: TaskGroup[] = []
  for (const entry of entries) {
    const last = groups[groups.length - 1]
    if (last && last.taskId === entry.taskId) {
      last.entries.push(entry)
    } else {
      groups.push({ taskId: entry.taskId, taskLabel: entry.taskLabel, entries: [entry] })
    }
  }
  return groups
}

/**
 * A running log of what the Manager itself has done - every Start/Stop/Kill/Restart, a
 * scheduled restart's stop/update/start sequence, and a backup's save/zip sequence -
 * independent of any one server's own ShooterGame.log or SteamCMD update log. Reads the
 * persistent src/main/lib/managerLog.ts file on mount, then appends live as new entries are
 * recorded (main process pushes them - see src/main/ipc/managerLog.ts), so this stays
 * current for as long as the page is open without polling.
 */
export default function ManagerLogView(): JSX.Element {
  const [entries, setEntries] = useState<ManagerLogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    window.api.managerLog.getLog().then((log) => {
      if (!cancelled) setEntries(log)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return window.api.managerLog.onLogChanged((entry) => {
      setEntries((prev) => [...prev, entry])
    })
  }, [])

  useEffect(() => {
    if (!autoScroll) return
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, autoScroll])

  const groups = groupByTask(entries)

  return (
    <div className="manager-log-page dashboard">
      <header className="dashboard-header">
        <h1>Manager Log</h1>
        <label className="checkbox">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </header>
      <p className="empty-state">
        Everything the Manager itself has done - Start/Stop/Kill/Restart, scheduled restarts, backups (created or
        restored), SteamCMD updates, and Anti-Crash Watchdog restarts - each colored by event type. Separate from
        any one server&apos;s own game log or update log. Persists across Manager restarts.
      </p>
      <div className="manager-log-feed" ref={feedRef}>
        {groups.length === 0 && <p className="empty-state">No manager activity recorded yet.</p>}
        {groups.map((group, i) => {
          const category = categoryForTaskId(group.taskId)
          return (
          <div
            className={category ? `manager-log-task manager-log-task--${category}` : 'manager-log-task'}
            key={`${group.taskId}-${i}`}
          >
            <div className="manager-log-task-header">
              <span className="manager-log-time">
                {group.entries[0].date} {group.entries[0].ts}
              </span>
              <strong>{group.taskLabel}</strong>
            </div>
            <div className="manager-log-task-entries">
              {group.entries.map((entry) => (
                <p key={entry.id} className={entry.level === 'error' ? 'manager-log-line error-message' : 'manager-log-line'}>
                  <span className="manager-log-time">{entry.ts}</span> {entry.message}
                </p>
              ))}
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
