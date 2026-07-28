import { useEffect, useRef, useState } from 'react'
import type { LogEvent, ServerProfile } from '@shared/types'

interface RconTabProps {
  profile: ServerProfile
}

interface RconHistoryEntry {
  command: string
  response: string
}

export default function RconTab({ profile }: RconTabProps): JSX.Element {
  const [command, setCommand] = useState('')
  const [rconHistory, setRconHistory] = useState<RconHistoryEntry[]>([])
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
    const result = await window.api.rcon.send(profile.id, trimmed)
    setRconHistory((prev) => [
      ...prev,
      { command: trimmed, response: result.ok ? (result.response ?? '(no response)') : `Error: ${result.error}` }
    ])
  }

  return (
    <div className="rcon-tab">
      <section className="rcon-panel">
        <h3>Live console</h3>
        <p className="empty-state">
          Classified events parsed live from this server&apos;s own ShooterGame.log (connections, chat, tames,
          kills, admin commands, saves, cryo, missions). Only shown while the server is running.
        </p>
        <div className="log-event-list" ref={consoleRef}>
          {events.length === 0 && <p className="empty-state">No events yet.</p>}
          {events.map((event, i) => (
            <div key={i} className={`log-event log-event-${event.cls}`}>
              <span className="log-event-ts">{event.ts}</span>
              <span className="log-event-label">{event.label}</span>
              <span className="log-event-text">{event.text}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rcon-panel">
        <h3>RCON console</h3>
        <div className="rcon-history">
          {rconHistory.map((entry, i) => (
            <div key={i} className="rcon-entry">
              <div className="rcon-command">&gt; {entry.command}</div>
              <div className="rcon-response">{entry.response}</div>
            </div>
          ))}
        </div>
        <form
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
