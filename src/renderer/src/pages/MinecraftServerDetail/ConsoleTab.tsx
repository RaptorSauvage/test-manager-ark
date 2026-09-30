import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { MinecraftConsoleLine, MinecraftProfile } from '@shared/minecraft'
import { useMinecraftServerStatuses } from '../../lib/useMinecraftServerStatuses'

interface ConsoleTabProps {
  profile: MinecraftProfile
}

/** Live console - unlike ARK's Group Console (a tailed, parsed log file), this reads
 *  straight from the process's own piped stdout (see minecraftProcess.ts), so lines show up
 *  close to verbatim and a command typed here is written straight to its stdin. */
export default function ConsoleTab({ profile }: ConsoleTabProps): JSX.Element {
  const [lines, setLines] = useState<MinecraftConsoleLine[]>([])
  const [command, setCommand] = useState('')
  const [sendError, setSendError] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const feedRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)
  const statuses = useMinecraftServerStatuses([profile.id])
  const state = statuses[profile.id]?.state ?? 'stopped'

  useEffect(() => {
    let cancelled = false
    setLines([])
    didInitialScroll.current = false
    window.api.minecraft.console.getBacklog(profile.id).then((backlog) => {
      if (!cancelled) setLines(backlog)
    })
    const unsubscribe = window.api.minecraft.console.onLine((profileId, line) => {
      if (profileId !== profile.id) return
      setLines((prev) => [...prev, line])
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [profile.id])

  useEffect(() => {
    const el = feedRef.current
    if (!el || lines.length === 0) return
    if (!didInitialScroll.current) {
      el.scrollTop = el.scrollHeight
      didInitialScroll.current = true
      return
    }
    if (autoScroll) el.scrollTop = el.scrollHeight
  }, [lines, autoScroll])

  async function handleSend(e: FormEvent): Promise<void> {
    e.preventDefault()
    const trimmed = command.trim()
    if (!trimmed) return
    setSendError('')
    setCommand('')
    const result = await window.api.minecraft.server.sendCommand(profile.id, trimmed)
    if (!result.ok) setSendError(result.error ?? 'Failed to send command.')
  }

  return (
    <div className="console-tab">
      <div className="group-console-filters">
        <label className="checkbox">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>
      <div className="group-console-feed" ref={feedRef}>
        {lines.length === 0 && (
          <p className="empty-state">
            {state === 'stopped' ? 'No console output yet - start the server to see it.' : 'No console output yet.'}
          </p>
        )}
        {lines.map((line, i) => (
          <div key={`${line.ts}-${i}`} className="mc-console-line">
            {line.text}
          </div>
        ))}
      </div>
      {sendError && <p className="error-message">{sendError}</p>}
      <form className="group-console-rcon" onSubmit={(e) => void handleSend(e)}>
        <input
          type="text"
          placeholder={state === 'running' ? 'Type a server command...' : 'Server is not running'}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          disabled={state !== 'running'}
        />
        <button type="submit" disabled={state !== 'running' || !command.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
