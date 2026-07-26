import { useEffect, useRef, useState } from 'react'
import type { ServerProfile, ServerLogLine } from '@shared/types'

interface ConsoleTabProps {
  profile: ServerProfile
}

interface RconHistoryEntry {
  command: string
  response: string
}

export default function ConsoleTab({ profile }: ConsoleTabProps): JSX.Element {
  const [lines, setLines] = useState<ServerLogLine[]>([])
  const [command, setCommand] = useState('')
  const [rconHistory, setRconHistory] = useState<RconHistoryEntry[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLines([])
    return window.api.server.onLogLine((line) => {
      if (line.profileId !== profile.id) return
      setLines((prev) => [...prev.slice(-499), line])
    })
  }, [profile.id])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [lines])

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
    <div className="console-tab">
      <section className="log-panel">
        <h3>Server output</h3>
        <div className="log-lines">
          {lines.length === 0 && <p className="empty-state">No output yet. Start the server to see logs here.</p>}
          {lines.map((line, i) => (
            <div key={i} className={`log-line log-${line.stream}`}>
              {line.line}
            </div>
          ))}
          <div ref={logEndRef} />
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
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="e.g. Broadcast Hello world"
          />
          <button type="submit">Send</button>
        </form>
      </section>
    </div>
  )
}
