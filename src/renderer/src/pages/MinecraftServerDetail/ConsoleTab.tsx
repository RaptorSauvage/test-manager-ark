import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { MinecraftConsoleLine, MinecraftProfile } from '@shared/minecraft'
import { useMinecraftServerStatuses } from '../../lib/useMinecraftServerStatuses'

interface ConsoleTabProps {
  profile: MinecraftProfile
}

/** Best-effort color classification for a raw console line, purely cosmetic - matches
 *  Minecraft's own log level (`[Server thread/ERROR]`/`WARN`) where present, plus a few
 *  wording-based special cases (the ready marker, join/leave, a graceful shutdown starting)
 *  that are worth calling out even though they log at INFO level. Checked in priority order
 *  since a stopping server's own log lines are still INFO. */
function classifyConsoleLine(text: string): string {
  if (/stopping (the )?server/i.test(text)) return 'stopping'
  if (/Done \([\d.]+s\)! For help/.test(text)) return 'ready'
  if (/\/ERROR]/.test(text)) return 'error'
  if (/\/WARN]/.test(text)) return 'warn'
  if (/\bjoined the game\b/i.test(text)) return 'join'
  if (/\b(left the game|lost connection|disconnected)\b/i.test(text)) return 'leave'
  return ''
}

/** Cap on how many lines are kept/rendered at once - this is a live feed, not a full log
 *  archive (that's what the on-disk console archive is for). Without this, a busy/chatty
 *  server left running with this tab open accumulates an ever-growing array, and every
 *  single new line re-renders the *entire* feed from scratch (the .map() below has no
 *  per-line memoization) - for a server whose log scrolls by quickly, that turned into a
 *  real "Not Responding" freeze, not just a slow scrollbar. Same number as
 *  minecraftProcess.ts's own CONSOLE_BACKLOG_LIMIT and GroupConsoleView's MAX_EVENTS. */
const MAX_LINES = 500

interface KeyedConsoleLine extends MinecraftConsoleLine {
  /** A monotonic id assigned once per line on arrival, independent of its position in
   *  `lines` - used as the React key below instead of the .map() index. Several lines can
   *  share the same `ts` (Date.now() in ms) when the log scrolls by quickly, and the index
   *  of every surviving line shifts by one every time the MAX_LINES cap drops the oldest
   *  one, so keying by either would make React treat the whole feed as brand new content on
   *  every single incoming line once the cap is active - tearing down and rebuilding up to
   *  500 DOM nodes per line instead of just appending one and dropping another. */
  _seq: number
}

/** Live console - unlike ARK's Group Console (a tailed, parsed log file), this reads
 *  straight from the process's own piped stdout (see minecraftProcess.ts), so lines show up
 *  close to verbatim and a command typed here is written straight to its stdin. */
export default function ConsoleTab({ profile }: ConsoleTabProps): JSX.Element {
  const [lines, setLines] = useState<KeyedConsoleLine[]>([])
  const [command, setCommand] = useState('')
  const [sendError, setSendError] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [chatMode, setChatMode] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)
  const nextSeq = useRef(0)
  const statuses = useMinecraftServerStatuses([profile.id])
  const status = statuses[profile.id]
  const state = status?.state ?? 'stopped'

  useEffect(() => {
    let cancelled = false
    setLines([])
    didInitialScroll.current = false
    nextSeq.current = 0
    window.api.minecraft.console.getBacklog(profile.id).then((backlog) => {
      if (!cancelled) setLines(backlog.map((line) => ({ ...line, _seq: nextSeq.current++ })))
    })
    const unsubscribe = window.api.minecraft.console.onLine((profileId, line) => {
      if (profileId !== profile.id) return
      setLines((prev) => {
        const next = [...prev, { ...line, _seq: nextSeq.current++ }]
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
      })
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
    // Chat mode sends whatever was typed as a broadcast chat message (Minecraft's own /say
    // command, same whether it reaches the server via stdin or RCON) instead of treating it
    // as a full server command - lets this box double as a way to talk to players without
    // typing "say " by hand every time.
    const toSend = chatMode ? `say ${trimmed}` : trimmed
    const result = await window.api.minecraft.server.sendCommand(profile.id, toSend)
    if (!result.ok) setSendError(result.error ?? 'Failed to send command.')
  }

  return (
    <div className="console-tab">
      <div className="group-console-feed" ref={feedRef}>
        {lines.length === 0 && (
          <p className="empty-state">
            {state === 'stopped' ? 'No console output yet - start the server to see it.' : 'No console output yet.'}
          </p>
        )}
        {lines.map((line) => {
          const cls = classifyConsoleLine(line.text)
          return (
            <div key={line._seq} className={cls ? `mc-console-line mc-console-line--${cls}` : 'mc-console-line'}>
              {line.text}
            </div>
          )
        })}
      </div>
      <div className="group-console-filters mc-console-controls">
        <label className="checkbox">
          <input type="checkbox" checked={chatMode} onChange={(e) => setChatMode(e.target.checked)} />
          Chat mode
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>
      {sendError && <p className="error-message">{sendError}</p>}
      <form className="group-console-rcon" onSubmit={(e) => void handleSend(e)}>
        <input
          type="text"
          placeholder={
            state !== 'running' ? 'Server is not running' : chatMode ? 'Type a chat message...' : 'Type a server command...'
          }
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
