import { useState } from 'react'
import type { ServerProfile } from '@shared/types'

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
    <section className="rcon-panel rcon-panel-standalone">
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
  )
}
