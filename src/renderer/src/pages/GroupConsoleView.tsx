import { useEffect, useRef, useState } from 'react'
import type { GroupConsoleEvent, ServerProfile } from '@shared/types'
import { PLAYER_NAME_OPEN, PLAYER_NAME_CLOSE } from '@shared/types'

interface GroupConsoleViewProps {
  groupName: string
  profiles: ServerProfile[]
  onBack: () => void
}

const ALL_EVENT_LABELS = ['JOIN', 'LEFT', 'CHAT', 'WARN', 'KILL', 'TAME', 'CMD', 'SAVE', 'CRYO', 'MISSION', 'READY']

/** Cap on how many merged events are kept/rendered - this is a live "what's happening right
 *  now across the group" feed, not a full log archive. */
const MAX_EVENTS = 500

/** Shared across every group's console - the same filter preference persists instead of
 *  resetting to "everything shown" each time you open one. */
const VISIBLE_LABELS_KEY = 'group-console-visible-labels'

function loadVisibleLabels(): Set<string> {
  try {
    const raw = localStorage.getItem(VISIBLE_LABELS_KEY)
    if (!raw) return new Set(ALL_EVENT_LABELS)
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set(ALL_EVENT_LABELS)
    return new Set(parsed.filter((label): label is string => ALL_EVENT_LABELS.includes(label)))
  } catch {
    return new Set(ALL_EVENT_LABELS)
  }
}

function saveVisibleLabels(labels: Set<string>): void {
  localStorage.setItem(VISIBLE_LABELS_KEY, JSON.stringify(Array.from(labels)))
}

function sortKey(event: GroupConsoleEvent): string {
  return `${event.date} ${event.ts}`
}

/** Splits an event's text on the invisible player-name markers, highlighting the player's
 *  name portion - same approach as the web dashboard's own vanilla-JS renderer. */
function renderEventText(text: string): Array<string | JSX.Element> {
  const openIdx = text.indexOf(PLAYER_NAME_OPEN)
  const closeIdx = text.indexOf(PLAYER_NAME_CLOSE)
  if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) return [text]
  const before = text.slice(0, openIdx)
  const player = text.slice(openIdx + 1, closeIdx)
  const after = text.slice(closeIdx + 1)
  return [
    before,
    <span key="player" className="player">
      {player}
    </span>,
    after
  ]
}

/**
 * Merges the live log feed of every server in a dashboard group into one chronological view,
 * each line tagged with which server it came from - same visual language (checkboxes to
 * show/hide event categories, colored labels) as the standalone web dashboard's console, but
 * reading from every server in the group at once instead of just one. Subscribes on mount,
 * unsubscribes on unmount (see src/main/lib/groupConsole.ts - the main process only tails a
 * profile's log while it's actually running AND this page is open, starting/stopping
 * individual tailers live as servers in the group start/stop).
 */
export default function GroupConsoleView({ groupName, profiles, onBack }: GroupConsoleViewProps): JSX.Element {
  const [events, setEvents] = useState<GroupConsoleEvent[]>([])
  const [visibleLabels, setVisibleLabels] = useState<Set<string>>(() => loadVisibleLabels())
  const feedRef = useRef<HTMLDivElement>(null)
  const profileIdsKey = profiles.map((p) => p.id).join(',')

  useEffect(() => {
    let cancelled = false
    window.api.groupConsole.subscribe(profiles.map((p) => p.id)).then((backlog) => {
      if (!cancelled) setEvents(backlog)
    })
    const unsubscribeEvent = window.api.groupConsole.onEvent((event) => {
      setEvents((prev) => {
        const next = [...prev, event].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
        return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
      })
    })
    return () => {
      cancelled = true
      unsubscribeEvent()
      void window.api.groupConsole.unsubscribe()
    }
    // profileIdsKey is the stable dependency; `profiles` itself is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIdsKey])

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events])

  function toggleLabel(label: string): void {
    setVisibleLabels((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      saveVisibleLabels(next)
      return next
    })
  }

  const filtered = events.filter((e) => visibleLabels.has(e.label))

  return (
    <div className="group-console-page">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>{groupName || 'Ungrouped'} — Group Console</h1>
      </header>

      <div className="group-console-filters">
        <span>Show:</span>
        {ALL_EVENT_LABELS.map((label) => (
          <label key={label} className="checkbox">
            <input type="checkbox" checked={visibleLabels.has(label)} onChange={() => toggleLabel(label)} />
            {label}
          </label>
        ))}
      </div>

      <div className="group-console-feed" ref={feedRef}>
        {filtered.length === 0 && <p className="empty-state">No events yet.</p>}
        {filtered.map((event, i) => (
          <div key={`${event.profileId}-${event.date}-${event.ts}-${i}`} className={`log-event log-event-${event.cls}`}>
            <span className="ts">{event.ts}</span>
            <span className="server-tag">[{event.profileName}]</span>
            <span className="label">{event.label}</span>
            <span className="text">{renderEventText(event.text)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
