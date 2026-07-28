import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PLAYER_NAME_OPEN, PLAYER_NAME_CLOSE, type LogEvent, type ServerProfile } from '@shared/types'

interface RconTabProps {
  profile: ServerProfile
}

function nowTs(): string {
  return new Date().toTimeString().slice(0, 8)
}

/** Renders event text as plain text, except for a JOIN/LEFT event's player name (marked
 *  with invisible open/close characters by the parser) which gets its own colored span
 *  so only that portion picks up the event's color - not the whole line. */
function renderEventText(text: string): ReactNode {
  const openIdx = text.indexOf(PLAYER_NAME_OPEN)
  const closeIdx = text.indexOf(PLAYER_NAME_CLOSE)
  if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) return text
  return (
    <>
      {text.slice(0, openIdx)}
      <span className="log-event-player">{text.slice(openIdx + 1, closeIdx)}</span>
      {text.slice(closeIdx + 1)}
    </>
  )
}

export default function RconTab({ profile }: RconTabProps): JSX.Element {
  const [command, setCommand] = useState('')
  const [events, setEvents] = useState<LogEvent[]>([])
  const consoleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setEvents([])
    let cancelled = false
    void window.api.logEvents.list(profile.id).then((initial) => {
      if (!cancelled) setEvents(initial)
    })
    const unsubscribe = window.api.logEvents.onEvent((eventProfileId, event) => {
      if (eventProfileId === profile.id) setEvents((prev) => [...prev, event])
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [profile.id])

  useEffect(() => {
    const el = consoleRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events])

  async function sendCommand(): Promise<void> {
    const trimmed = command.trim()
    if (!trimmed) return
    setCommand('')
    setEvents((prev) => [...prev, { label: 'RCON', cls: 'rcon-cmd', text: `> ${trimmed}`, ts: nowTs() }])
    const result = await window.api.rcon.send(profile.id, trimmed)
    setEvents((prev) => [
      ...prev,
      {
        label: 'RCON',
        cls: result.ok ? 'rcon-resp' : 'rcon-error',
        text: result.ok ? (result.response ?? '(no response)') : `Error: ${result.error}`,
        ts: nowTs()
      }
    ])
  }

  return (
    <div className="rcon-tab">
      <section className="rcon-panel">
        <h3>Console &amp; RCON</h3>
        <p className="empty-state">
          Classified events parsed live from this server&apos;s own ShooterGame.log (connections, chat, tames,
          kills, admin commands, saves, cryo, missions) - only while the server is running - plus every RCON
          command you send below and its response, right in the same feed.
        </p>
        <div className="log-event-list" ref={consoleRef}>
          {events.length === 0 && <p className="empty-state">No events yet.</p>}
          {events.map((event, i) => (
            <div key={i} className={`log-event log-event-${event.cls}`}>
              <span className="log-event-ts">{event.ts}</span>
              <span className="log-event-label">{event.label}</span>
              <span className="log-event-text">{renderEventText(event.text)}</span>
            </div>
          ))}
        </div>
        <form
          className="rcon-input-row"
          onSubmit={(e) => {
            e.preventDefault()
            void sendCommand()
          }}
        >
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g. Broadcast Hello world" />
          <button type="submit">Send</button>
        </form>
      </section>
    </div>
  )
}
