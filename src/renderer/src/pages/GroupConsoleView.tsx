import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import type { GroupConsoleEvent, RconResult, ServerProfile } from '@shared/types'
import { PLAYER_NAME_OPEN, PLAYER_NAME_CLOSE } from '@shared/types'
import { useServerStatuses } from '../lib/useServerStatuses'

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

const RCON_TARGET_ALL = 'ALL'

type ContextAction = 'start' | 'stop' | 'restart' | 'update' | 'updateRestart'

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

/** Converts ARK's own "YYYY.MM.DD" log date into a short DD/MM display. */
function formatDateDDMM(date: string): string {
  const [, mm, dd] = date.split('.')
  return dd && mm ? `${dd}/${mm}` : date
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

interface RconResultEntry extends RconResult {
  profileId: string
  profileName: string
}

interface StateNotification {
  id: string
  profileName: string
  type: 'start' | 'stop'
}

/**
 * Merges the live log feed of every server in a dashboard group into one chronological view,
 * each line tagged with which server it came from - same visual language (checkboxes to
 * show/hide event categories, colored labels) as the standalone web dashboard's console, but
 * reading from every server in the group at once instead of just one. Subscribes on mount,
 * unsubscribes on unmount (see src/main/lib/groupConsole.ts - the main process only tails a
 * profile's log while it's actually running AND this page is open, starting/stopping
 * individual tailers live as servers in the group start/stop). Also offers an RCON command
 * bar (send to one server or the whole group) and a sidebar summarizing each server's live
 * status, version, players and resource usage, with a right-click menu on each server card
 * to start/stop/restart/update it directly - same actions and color coding as the Dashboard's
 * own per-server and "All" buttons.
 */
export default function GroupConsoleView({ groupName, profiles, onBack }: GroupConsoleViewProps): JSX.Element {
  const [events, setEvents] = useState<GroupConsoleEvent[]>([])
  const [visibleLabels, setVisibleLabels] = useState<Set<string>>(() => loadVisibleLabels())
  const [rconTarget, setRconTarget] = useState<string>(RCON_TARGET_ALL)
  const [rconCommand, setRconCommand] = useState('')
  const [rconSending, setRconSending] = useState(false)
  const [rconResults, setRconResults] = useState<RconResultEntry[]>([])
  const [gameVersions, setGameVersions] = useState<Record<string, string | null>>({})
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})
  const [contextMenu, setContextMenu] = useState<{ profileId: string; x: number; y: number } | null>(null)
  const [notifications, setNotifications] = useState<StateNotification[]>([])
  const feedRef = useRef<HTMLDivElement>(null)
  const prevStatesRef = useRef<Record<string, string>>({})
  const profileIdsKey = profiles.map((p) => p.id).join(',')
  const statuses = useServerStatuses(profiles.map((p) => p.id))

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
    let cancelled = false
    Promise.all(profiles.map(async (p) => [p.id, await window.api.server.getGameVersion(p.id)] as const)).then(
      (entries) => {
        if (!cancelled) setGameVersions(Object.fromEntries(entries))
      }
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIdsKey])

  // Pops a transient toast whenever a server's live status actually transitions into
  // 'running' or 'stopped' - compares against the previously-seen state per profile so a
  // profile's first-ever status (on mount, or whenever it happens to resolve) never counts
  // as a transition, only a real change does.
  useEffect(() => {
    const prevStates = prevStatesRef.current
    const nextStates: Record<string, string> = { ...prevStates }
    const toNotify: StateNotification[] = []

    for (const profile of profiles) {
      const state = statuses[profile.id]?.state
      if (!state) continue
      const prevState = prevStates[profile.id]
      nextStates[profile.id] = state
      if (prevState === undefined || prevState === state) continue
      if (state === 'running') {
        toNotify.push({ id: `${profile.id}-${Date.now()}`, profileName: profile.name, type: 'start' })
      } else if (state === 'stopped') {
        toNotify.push({ id: `${profile.id}-${Date.now()}`, profileName: profile.name, type: 'stop' })
      }
    }
    prevStatesRef.current = nextStates

    if (toNotify.length === 0) return
    setNotifications((prev) => [...prev, ...toNotify])
    for (const notification of toNotify) {
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== notification.id))
      }, 6000)
    }
    // profileIdsKey (via `profiles`) is the stable dependency; `statuses` is a fresh object
    // on every live status update, which is exactly what should retrigger this diff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, profileIdsKey])

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [contextMenu])

  function toggleLabel(label: string): void {
    setVisibleLabels((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      saveVisibleLabels(next)
      return next
    })
  }

  async function handleSendRcon(e: FormEvent): Promise<void> {
    e.preventDefault()
    const command = rconCommand.trim()
    if (!command || rconSending) return
    const targets = rconTarget === RCON_TARGET_ALL ? profiles : profiles.filter((p) => p.id === rconTarget)
    if (targets.length === 0) return

    setRconSending(true)
    setRconResults([])
    try {
      const results = await Promise.all(
        targets.map(async (profile) => {
          const result = await window.api.groupConsole.sendRcon(profile.id, command)
          return { profileId: profile.id, profileName: profile.name, ...result }
        })
      )
      setRconResults(results)
    } finally {
      setRconSending(false)
    }
  }

  function openContextMenu(e: MouseEvent, profileId: string): void {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ profileId, x: e.clientX, y: e.clientY })
  }

  async function runContextAction(profile: ServerProfile, action: ContextAction): Promise<void> {
    setContextMenu(null)
    setCardErrors((prev) => ({ ...prev, [profile.id]: '' }))
    try {
      if (action === 'updateRestart') {
        const wasRunning = statuses[profile.id]?.state === 'running'
        if (wasRunning) await window.api.server.stop(profile.id)
        await window.api.server.update(profile.id)
        if (wasRunning) await window.api.server.start(profile.id)
      } else if (action === 'update') {
        await window.api.server.update(profile.id)
      } else {
        await window.api.server[action](profile.id)
      }
    } catch (err) {
      setCardErrors((prev) => ({ ...prev, [profile.id]: (err as Error).message }))
    }
  }

  const filtered = events.filter((e) => visibleLabels.has(e.label))
  const contextProfile = contextMenu ? profiles.find((p) => p.id === contextMenu.profileId) : undefined
  const contextState = contextProfile ? (statuses[contextProfile.id]?.state ?? 'stopped') : 'stopped'

  const onlineCount = profiles.filter((p) => statuses[p.id]?.state === 'running').length
  const offlineCount = profiles.length - onlineCount
  const totalPlayers = profiles.reduce((sum, p) => sum + (statuses[p.id]?.players?.length ?? 0), 0)
  const totalCpu = profiles.reduce((sum, p) => sum + (statuses[p.id]?.cpu ?? 0), 0)
  const totalMemoryMB = profiles.reduce((sum, p) => sum + (statuses[p.id]?.memoryMB ?? 0), 0)

  return (
    <div className="group-console-page">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>{groupName || 'Ungrouped'} — Group Console</h1>
      </header>

      {notifications.length > 0 && (
        <div className="group-console-notifications">
          {notifications.map((n) => (
            <div key={n.id} className={`group-console-notification group-console-notification-${n.type}`}>
              {n.profileName} {n.type === 'start' ? 'started' : 'stopped'}
            </div>
          ))}
        </div>
      )}

      <div className="group-console-body">
        <div className="group-console-main">
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
                <span className="date">{formatDateDDMM(event.date)}</span>
                <span className="ts">{event.ts}</span>
                <span className="server-tag">[{event.profileName}]</span>
                <span className="label">{event.label}</span>
                <span className="text">{renderEventText(event.text)}</span>
              </div>
            ))}
          </div>

          {rconResults.length > 0 && (
            <div className="group-console-rcon-results">
              {rconResults.map((result) => (
                <p key={result.profileId} className={result.ok ? 'rcon-result-ok' : 'rcon-result-error'}>
                  <strong>{result.profileName}:</strong> {result.ok ? result.response || '(no response)' : result.error}
                </p>
              ))}
            </div>
          )}

          <form className="group-console-rcon" onSubmit={(e) => void handleSendRcon(e)}>
            <select value={rconTarget} onChange={(e) => setRconTarget(e.target.value)}>
              <option value={RCON_TARGET_ALL}>ALL</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="RCON command..."
              value={rconCommand}
              onChange={(e) => setRconCommand(e.target.value)}
            />
            <button type="submit" disabled={rconSending || !rconCommand.trim()}>
              {rconSending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>

        <div className="group-console-divider" />

        <aside className="group-console-sidebar">
          <dl className="group-console-cluster-stats">
            <div>
              <dt>Online</dt>
              <dd>
                {onlineCount} <span className="muted">({offlineCount} off)</span>
              </dd>
            </div>
            <div>
              <dt>Players</dt>
              <dd>{totalPlayers}</dd>
            </div>
            <div>
              <dt>CPU</dt>
              <dd>{totalCpu.toFixed(1)}%</dd>
            </div>
            <div>
              <dt>RAM</dt>
              <dd>{totalMemoryMB} MB</dd>
            </div>
          </dl>

          {profiles.map((profile) => {
            const status = statuses[profile.id]
            const state = status?.state ?? 'stopped'
            return (
              <div
                className="server-summary-card"
                key={profile.id}
                onContextMenu={(e) => openContextMenu(e, profile.id)}
              >
                <div className="server-summary-card-header">
                  <h3>{profile.name}</h3>
                  <span className={`badge badge-${state}`}>{state}</span>
                </div>
                <dl className="server-summary-card-info">
                  <div>
                    <dt>Version</dt>
                    <dd>{gameVersions[profile.id] ?? '-'}</dd>
                  </div>
                  <div>
                    <dt>Players</dt>
                    <dd>
                      {status?.players?.length ?? 0}/{profile.maxPlayers}
                    </dd>
                  </div>
                  {status?.cpu !== undefined && (
                    <div>
                      <dt>CPU</dt>
                      <dd>{status.cpu}%</dd>
                    </div>
                  )}
                  {status?.memoryMB !== undefined && (
                    <div>
                      <dt>RAM</dt>
                      <dd>{status.memoryMB} MB</dd>
                    </div>
                  )}
                </dl>
                {cardErrors[profile.id] && <p className="error-message">{cardErrors[profile.id]}</p>}
              </div>
            )
          })}
        </aside>
      </div>

      {contextMenu && contextProfile && (
        <div className="server-context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <button
            className="btn-start-all"
            disabled={contextState !== 'stopped'}
            onClick={() => void runContextAction(contextProfile, 'start')}
          >
            Start
          </button>
          <button
            className="btn-stop-all"
            disabled={contextState !== 'running'}
            onClick={() => void runContextAction(contextProfile, 'stop')}
          >
            Stop
          </button>
          <button
            className="btn-restart-all"
            disabled={contextState !== 'running'}
            onClick={() => void runContextAction(contextProfile, 'restart')}
          >
            Restart
          </button>
          <button
            className="btn-update-all"
            disabled={contextState !== 'stopped'}
            onClick={() => void runContextAction(contextProfile, 'update')}
            title="Install/update the server files via SteamCMD"
          >
            Update
          </button>
          <button
            className="btn-update-restart"
            onClick={() => void runContextAction(contextProfile, 'updateRestart')}
            title="Stops the server if running, updates it via SteamCMD, then starts it back up if it was running"
          >
            Update Restart
          </button>
        </div>
      )}
    </div>
  )
}
