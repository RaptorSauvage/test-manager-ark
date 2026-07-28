import fs from 'node:fs'
import http from 'node:http'
import type { AppSettings, LogEvent } from '@shared/types'
import { listProfiles } from '../store'
import { getStatus, getLogFilePath, watchLogFile } from './serverProcess'
import { sendRconCommand } from './rcon'
import { parseLogChunk, createLogEventCaches } from './logEvents'

let server: http.Server | null = null
let lastError: string | null = null

/** How much of ShooterGame.log to re-read for backlog on a fresh page load/reconnect,
 *  and how many of the parsed events out of that backlog to actually keep - same defaults
 *  as the standalone Python dashboard this page replaces. */
const BACKLOG_BYTES = 300_000
const BACKLOG_MAX_LINES = 60

/**
 * Reads a server's live event feed straight from its own ShooterGame.log, independent of
 * whatever the Manager's own process tracking thinks its state is - same approach as the
 * standalone Python dashboard this page replaces (a fresh per-connection file tailer, not
 * tied to any "is this server running" bookkeeping), so the web dashboard keeps working
 * even for a server the Manager didn't itself start/adopt.
 */
function readLogBacklog(installDir: string): LogEvent[] {
  const logPath = getLogFilePath(installDir)
  if (!fs.existsSync(logPath)) return []

  const size = fs.statSync(logPath).size
  const readSize = Math.min(size, BACKLOG_BYTES)
  const buffer = Buffer.alloc(readSize)
  const fd = fs.openSync(logPath, 'r')
  try {
    fs.readSync(fd, buffer, 0, readSize, size - readSize)
  } finally {
    fs.closeSync(fd)
  }

  let text = buffer.toString('utf-8')
  if (readSize < size) {
    // Drop a possibly-truncated first line when starting mid-file.
    const firstNewline = text.indexOf('\n')
    if (firstNewline >= 0) text = text.slice(firstNewline + 1)
  }

  return parseLogChunk(text, createLogEventCaches()).slice(-BACKLOG_MAX_LINES)
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err as Error)
      }
    })
    req.on('error', reject)
  })
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(DASHBOARD_HTML)
    return
  }

  if (req.method === 'GET' && path === '/api/servers') {
    const servers = listProfiles().map((profile) => {
      const status = getStatus(profile.id)
      return {
        id: profile.id,
        name: profile.name,
        state: status.state,
        players: status.players ?? [],
        cpu: status.cpu ?? null,
        memoryMB: status.memoryMB ?? null
      }
    })
    sendJson(res, 200, servers)
    return
  }

  const eventsMatch = path.match(/^\/api\/servers\/([^/]+)\/events$/)
  if (req.method === 'GET' && eventsMatch) {
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(eventsMatch[1]))
    sendJson(res, 200, profile ? readLogBacklog(profile.installDir) : [])
    return
  }

  const streamMatch = path.match(/^\/api\/servers\/([^/]+)\/events\/stream$/)
  if (req.method === 'GET' && streamMatch) {
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(streamMatch[1]))
    if (!profile) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Unknown server')
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write('\n')
    const caches = createLogEventCaches()
    const stopWatching = watchLogFile(profile.installDir, (chunk) => {
      for (const event of parseLogChunk(chunk, caches)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
    })
    req.on('close', stopWatching)
    return
  }

  const rconMatch = path.match(/^\/api\/servers\/([^/]+)\/rcon$/)
  if (req.method === 'POST' && rconMatch) {
    const profileId = decodeURIComponent(rconMatch[1])
    const profile = listProfiles().find((p) => p.id === profileId)
    if (!profile) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    readJsonBody(req)
      .then(async (body) => {
        const command = typeof body.command === 'string' ? body.command.trim() : ''
        if (!command) {
          sendJson(res, 400, { ok: false, error: 'Empty command' })
          return
        }
        const result = await sendRconCommand(profile, command)
        sendJson(res, 200, result)
      })
      .catch(() => sendJson(res, 400, { ok: false, error: 'Invalid request body' }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not found')
}

export function stopWebDashboard(): void {
  if (server) {
    server.close()
    server = null
  }
}

/** Starts the web dashboard, bound to 127.0.0.1 only - this page has no authentication
 *  (same posture as the standalone Python dashboard it replaces), so it must never listen
 *  on any other interface. */
export function startWebDashboard(port: number): void {
  stopWebDashboard()
  lastError = null
  server = http.createServer(handleRequest)
  server.on('error', (err) => {
    lastError = (err as Error).message
    server = null
  })
  server.listen(port, '127.0.0.1')
}

export function applyWebDashboardSettings(settings: AppSettings): void {
  if (settings.webDashboardEnabled) startWebDashboard(settings.webDashboardPort)
  else stopWebDashboard()
}

export function getWebDashboardStatus(): { running: boolean; error: string | null } {
  return { running: server !== null, error: lastError }
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ARK Server Manager - Web Console</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #14161a; --panel: #1d2027; --border: #2c303a; --text: #e6e8ec; --muted: #9aa0ab;
    --accent: #4f8cff; --danger: #e0555b; --ok: #3fbf6f; --warn: #e0a63f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    display: flex; flex-direction: column; height: 100vh;
  }
  header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 1rem; margin: 0; }
  select, input, button { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 0.9rem; }
  button { cursor: pointer; }
  button:hover { border-color: var(--accent); }
  #status { color: var(--muted); font-size: 0.85rem; }
  main { flex: 1; display: flex; flex-direction: column; padding: 12px 16px; min-height: 0; }
  .panel { flex: 1; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; min-height: 0; }
  #console { flex: 1; overflow-y: auto; font-size: 0.82rem; font-family: Consolas, Menlo, monospace; min-height: 200px; }
  .log-event { display: flex; gap: 8px; padding: 2px 0; }
  .log-event .ts { color: var(--muted); flex-shrink: 0; }
  .log-event .label { flex-shrink: 0; width: 60px; font-weight: 600; }
  .log-event .text { white-space: pre-wrap; word-break: break-word; }
  .log-event-join .label, .log-event-ready .label, .log-event-join .text, .log-event-ready .text { color: #1f8a4c; }
  .log-event-leave .label, .log-event-save .label, .log-event-leave .text, .log-event-save .text { color: var(--muted); }
  .log-event-cmd .label, .log-event-freeze .label, .log-event-cmd .text, .log-event-freeze .text { color: var(--accent); }
  .log-event-warn .label, .log-event-mission .label, .log-event-warn .text, .log-event-mission .text { color: var(--warn); }
  .log-event-kill .label, .log-event-kill .text { color: var(--danger); }
  .log-event-tame .label, .log-event-tame .text { color: var(--ok); }
  .log-event-rcon-cmd .label, .log-event-rcon-cmd .text { color: var(--accent); }
  .log-event-rcon-error .label, .log-event-rcon-error .text { color: var(--danger); }
  #rcon-form { display: flex; gap: 8px; margin-top: 8px; }
  #rcon-input { flex: 1; }
  .empty-state { color: var(--muted); font-size: 0.85rem; }
</style>
</head>
<body>
<header>
  <h1>ARK Server Manager</h1>
  <select id="server-select"></select>
  <span id="status"></span>
</header>
<main>
  <section class="panel">
    <div id="console"></div>
    <form id="rcon-form">
      <input id="rcon-input" placeholder="e.g. Broadcast Hello world" autocomplete="off" />
      <button type="submit">Send</button>
    </form>
  </section>
</main>
<script>
(function () {
  var currentId = null;
  var es = null;
  var consoleEl = document.getElementById('console');
  var select = document.getElementById('server-select');
  var statusEl = document.getElementById('status');
  var rconForm = document.getElementById('rcon-form');
  var rconInput = document.getElementById('rcon-input');

  function nowTs() {
    return new Date().toTimeString().slice(0, 8);
  }

  function addEvent(ev) {
    var div = document.createElement('div');
    div.className = 'log-event log-event-' + ev.cls;
    var ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = ev.ts;
    var label = document.createElement('span'); label.className = 'label'; label.textContent = ev.label;
    var text = document.createElement('span'); text.className = 'text'; text.textContent = ev.text;
    div.appendChild(ts); div.appendChild(label); div.appendChild(text);
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function renderStatus(s) {
    if (!s) { statusEl.textContent = ''; return; }
    var parts = [s.state];
    if (s.players) parts.push(s.players.length + ' player(s)' + (s.players.length ? ': ' + s.players.join(', ') : ''));
    if (s.cpu != null) parts.push('CPU ' + s.cpu + '%');
    if (s.memoryMB != null) parts.push('RAM ' + s.memoryMB + ' MB');
    statusEl.textContent = parts.join(' — ');
  }

  function selectServer(id) {
    if (id === currentId) return;
    currentId = id;
    consoleEl.innerHTML = '';
    if (es) { es.close(); es = null; }
    if (!id) return;
    fetch('/api/servers/' + encodeURIComponent(id) + '/events')
      .then(function (r) { return r.json(); })
      .then(function (events) { events.forEach(addEvent); });
    es = new EventSource('/api/servers/' + encodeURIComponent(id) + '/events/stream');
    es.onmessage = function (msg) { addEvent(JSON.parse(msg.data)); };
  }

  function loadServers() {
    fetch('/api/servers').then(function (r) { return r.json(); }).then(function (servers) {
      var previousValue = select.value;
      select.innerHTML = '';
      servers.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name + ' (' + s.state + ')';
        select.appendChild(opt);
      });
      if (previousValue && servers.some(function (s) { return s.id === previousValue; })) {
        select.value = previousValue;
      }
      if (!currentId && servers.length > 0) selectServer(servers[0].id);
      renderStatus(servers.find(function (s) { return s.id === select.value; }));
    });
  }

  select.addEventListener('change', function () { selectServer(select.value); });

  rconForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var command = rconInput.value.trim();
    if (!command || !currentId) return;
    rconInput.value = '';
    addEvent({ label: 'RCON', cls: 'rcon-cmd', text: '> ' + command, ts: nowTs() });
    fetch('/api/servers/' + encodeURIComponent(currentId) + '/rcon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: command })
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        addEvent({
          label: 'RCON',
          cls: result.ok ? 'rcon-resp' : 'rcon-error',
          text: result.ok ? (result.response || '(no response)') : ('Error: ' + result.error),
          ts: nowTs()
        });
      });
  });

  loadServers();
  setInterval(loadServers, 5000);
})();
</script>
</body>
</html>
`
