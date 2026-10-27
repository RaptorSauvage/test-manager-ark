import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { MinecraftProfile } from '@shared/minecraft'
import { useMinecraftServerStatuses } from '../../lib/useMinecraftServerStatuses'

import '@xterm/xterm/css/xterm.css'

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

/** True-color ANSI foreground codes matching this app's own CSS variables of the same name
 *  (styles.css's :root) - xterm.js renders onto its own canvas, not the DOM, so a CSS class
 *  per line (the previous design) has no equivalent here; wrapping the text itself in the
 *  matching escape sequence is the terminal-native way to get the same color. */
const ANSI_RESET = '\u001b[0m'
const CLASS_ANSI_COLOR: Record<string, string> = {
  error: '\u001b[38;2;224;85;91m', // --danger
  stopping: '\u001b[38;2;224;85;91m', // --danger
  warn: '\u001b[38;2;224;166;63m', // --warn
  leave: '\u001b[38;2;224;166;63m', // --warn
  ready: '\u001b[38;2;63;191;111m', // --ok
  join: '\u001b[38;2;34;211;238m' // --cyan
}

function writeLine(terminal: Terminal, text: string): void {
  const color = CLASS_ANSI_COLOR[classifyConsoleLine(text)]
  terminal.writeln(color ? `${color}${text}${ANSI_RESET}` : text)
}

/**
 * Live console - unlike ARK's Group Console (a tailed, parsed log file), this reads straight
 * from the process's own piped stdout (see minecraftProcess.ts), so lines show up close to
 * verbatim and a command typed below is written straight to its stdin.
 *
 * Rendered with xterm.js (a real terminal emulator, same library Pterodactyl's panel uses
 * for this exact job) instead of a React list of <div> lines - a previous version kept the
 * most recent 250 lines in React state and re-rendered the whole feed on every single
 * incoming line (even capped and keyed correctly, that's still real reconciliation cost per
 * line). xterm.js keeps and redraws its own scrollback buffer entirely outside React, so a
 * fast-scrolling log no longer costs a React render at all - just one `writeln` call.
 * disableStdin - the terminal itself is output-only; the actual command input is the
 * separate text box below it, same split Pterodactyl's own console uses.
 */
function createTerminal(): Terminal {
  return new Terminal({
    disableStdin: true,
    cursorStyle: 'underline',
    fontSize: 13,
    fontFamily: "'Cascadia Code', 'Consolas', monospace",
    scrollback: 1000,
    theme: {
      background: '#14161a', // --bg
      foreground: '#e6e8ec', // --text
      cursor: 'transparent'
    }
  })
}

export default function ConsoleTab({ profile }: ConsoleTabProps): JSX.Element {
  const [command, setCommand] = useState('')
  const [sendError, setSendError] = useState('')
  const [chatMode, setChatMode] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const statuses = useMinecraftServerStatuses([profile.id])
  const status = statuses[profile.id]
  const state = status?.state ?? 'stopped'

  // Mounts a *fresh* Terminal instance into the DOM every time this effect runs, and disposes
  // exactly that instance on cleanup - deliberately not a single Terminal instance held across
  // the whole component's lifetime (an earlier version built it once via useMemo and relied on
  // mount/dispose happening exactly once). React 18's Strict Mode intentionally mounts every
  // component's effects twice in development (mount -> cleanup -> mount again, to catch
  // exactly this class of bug) - with a single shared Terminal, that second mount reopened an
  // instance already dispose()'d by the first cleanup, which xterm.js doesn't support and
  // failed silently (no console error, just a permanently blank Console tab in dev mode only -
  // a real report traced to this). Creating a new Terminal per effect invocation makes a
  // dispose-then-reopen cycle a non-issue: there's nothing stale to reopen.
  //
  // Also folds in the backlog fetch + live-line subscription (a separate effect before) so
  // everything that depends on having a live `terminal` lives in the one effect that actually
  // owns its lifetime - also still refetches/resets on profile.id or consoleLoggingEnabled
  // changing, same as before.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const terminal = createTerminal()
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(el)
    fitAddon.fit()

    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(el)

    let cancelled = false
    let unsubscribe = (): void => {}

    // Nothing to fetch/subscribe to - minecraftProcess.ts's doSpawn skips the archive write
    // and the live 'line' emit entirely for a profile with this off, so there's never
    // anything in either the backlog or the live feed to begin with.
    if (!profile.consoleLoggingEnabled) {
      terminal.writeln(
        'Live console log is turned off for this server (Start Settings). Starting/stopping and sending commands below still work either way.'
      )
    } else {
      window.api.minecraft.console.getBacklog(profile.id).then((backlog) => {
        if (cancelled) return
        if (backlog.length === 0) {
          terminal.writeln(state === 'stopped' ? 'No console output yet - start the server to see it.' : 'No console output yet.')
        } else {
          for (const line of backlog) writeLine(terminal, line.text)
        }
      })
      unsubscribe = window.api.minecraft.console.onLine((profileId, line) => {
        if (profileId !== profile.id) return
        writeLine(terminal, line.text)
      })
    }

    return () => {
      cancelled = true
      unsubscribe()
      resizeObserver.disconnect()
      terminal.dispose()
    }
    // `state` deliberately excluded - this effect's own backlog fetch (not a live status
    // change) decides which placeholder message to show, and it must not re-run (tearing down
    // and recreating the whole terminal) just because the server's status happened to tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.consoleLoggingEnabled])

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
      <div className="mc-console-terminal" ref={containerRef} />
      <div className="group-console-filters mc-console-controls">
        <label className="checkbox">
          <input type="checkbox" checked={chatMode} onChange={(e) => setChatMode(e.target.checked)} />
          Chat mode
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
