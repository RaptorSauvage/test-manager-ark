import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import type { AppSettings, LogEvent } from '@shared/types'
import { listProfiles, getSettings, saveSettings } from '../store'
import { getStatus, getLogFilePath, watchLogFile } from './serverProcess'
import { sendRconCommand, parsePlayerListWithIds } from './rcon'
import { parseLogChunk, createLogEventCaches } from './logEvents'

let server: http.Server | null = null
let lastError: string | null = null
let lastHost: string | null = null

/** How much of ShooterGame.log to re-read for backlog on a fresh page load/reconnect,
 *  and how many of the parsed events out of that backlog to actually keep - same defaults
 *  as the standalone Python dashboard this page replaces. */
const BACKLOG_BYTES = 300_000
const BACKLOG_MAX_LINES = 60

/** Event categories that can be individually hidden from the web dashboard's feed. */
const ALL_EVENT_LABELS = ['JOIN', 'LEFT', 'CHAT', 'WARN', 'KILL', 'TAME', 'CMD', 'SAVE', 'CRYO', 'MISSION', 'READY']

function getDisabledLabels(): Set<string> {
  return new Set(getSettings().webDashboardDisabledLabels ?? [])
}

function setLabelEnabled(label: string, enabled: boolean): void {
  const settings = getSettings()
  const disabled = new Set(settings.webDashboardDisabledLabels ?? [])
  if (enabled) disabled.delete(label)
  else disabled.add(label)
  saveSettings({ ...settings, webDashboardDisabledLabels: Array.from(disabled) })
}

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

  const disabled = getDisabledLabels()
  return parseLogChunk(text, createLogEventCaches())
    .filter((event) => !disabled.has(event.label))
    .slice(-BACKLOG_MAX_LINES)
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
      const disabled = getDisabledLabels()
      for (const event of parseLogChunk(chunk, caches)) {
        if (disabled.has(event.label)) continue
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
    })
    req.on('close', stopWatching)
    return
  }

  if (req.method === 'GET' && path === '/api/labelsettings') {
    const disabled = getDisabledLabels()
    const result: Record<string, boolean> = {}
    for (const label of ALL_EVENT_LABELS) result[label] = !disabled.has(label)
    sendJson(res, 200, result)
    return
  }

  const labelMatch = path.match(/^\/api\/labelsettings\/([^/]+)$/)
  if (req.method === 'POST' && labelMatch) {
    const label = decodeURIComponent(labelMatch[1])
    if (!ALL_EVENT_LABELS.includes(label)) {
      sendJson(res, 404, { error: 'Unknown event label' })
      return
    }
    readJsonBody(req)
      .then((body) => {
        const enabled = typeof body.enabled !== 'boolean' || body.enabled
        setLabelEnabled(label, enabled)
        sendJson(res, 200, { label, enabled })
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid request body' }))
    return
  }

  const playersMatch = path.match(/^\/api\/servers\/([^/]+)\/players$/)
  if (req.method === 'GET' && playersMatch) {
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(playersMatch[1]))
    if (!profile) {
      sendJson(res, 200, [])
      return
    }
    sendRconCommand(profile, 'ListPlayers').then((result) => {
      sendJson(res, 200, result.ok && result.response ? parsePlayerListWithIds(result.response) : [])
    })
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

/** Starts the web dashboard bound to `host` - '127.0.0.1' (default) keeps it reachable
 *  from this machine only; '0.0.0.0' or a specific local IP makes it reachable from other
 *  devices on the LAN. This page has no authentication of its own (same posture as the
 *  standalone Python dashboard it replaces), so widening this is a deliberate choice made
 *  in Settings, never a default. */
export function startWebDashboard(port: number, host: string): void {
  stopWebDashboard()
  lastError = null
  lastHost = host
  server = http.createServer(handleRequest)
  server.on('error', (err) => {
    lastError = (err as Error).message
    server = null
  })
  server.listen(port, host)
}

export function applyWebDashboardSettings(settings: AppSettings): void {
  if (settings.webDashboardEnabled) startWebDashboard(settings.webDashboardPort, settings.webDashboardHost || '127.0.0.1')
  else stopWebDashboard()
}

export function getWebDashboardStatus(): { running: boolean; error: string | null; host: string | null } {
  return { running: server !== null, error: lastError, host: server ? lastHost : null }
}

/** Non-internal IPv4 addresses of this machine, so Settings can suggest what to type into
 *  the Host field for LAN access instead of the user having to look it up themselves. */
export function getLocalNetworkIps(): string[] {
  const ips: string[] = []
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const addr of addresses ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address)
    }
  }
  return ips
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
  .log-event-join .label, .log-event-ready .label { color: #1f8a4c; }
  .log-event-leave .label { color: #a83239; }
  .log-event-save .label { color: var(--muted); }
  .log-event-cmd .label, .log-event-freeze .label { color: var(--accent); }
  .log-event-warn .label, .log-event-mission .label { color: var(--warn); }
  .log-event-kill .label { color: var(--danger); }
  .log-event-tame .label { color: var(--ok); }
  .log-event-rcon-cmd .label { color: var(--accent); }
  .log-event-rcon-error .label { color: var(--danger); }
  .log-event-join .player { color: #1f8a4c; }
  .log-event-leave .player { color: #a83239; }
  #rcon-form { display: flex; gap: 8px; margin-top: 8px; }
  #rcon-input { flex: 1; }
  .empty-state { color: var(--muted); font-size: 0.85rem; }
  #filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 0.8rem; color: var(--muted); margin-bottom: 10px; }
  #filters label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  #filters input { padding: 0; width: auto; }
  .content-row { flex: 1; display: flex; gap: 12px; min-height: 0; }
  .console-panel { flex: 3; }
  .players-panel { flex: 1; min-width: 220px; max-width: 300px; }
  .players-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .players-header h3 { margin: 0; font-size: 0.95rem; }
  .players-count { background: var(--accent); color: #fff; border-radius: 999px; padding: 1px 9px; font-size: 0.75rem; }
  #players-list { flex: 1; overflow-y: auto; font-size: 0.85rem; }
  .player-row { padding: 6px 8px; border-radius: 6px; }
  .player-row:hover { background: var(--bg); }
  .context-menu { position: fixed; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 4px; z-index: 1000; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5); min-width: 150px; }
  .context-menu button { display: block; width: 100%; text-align: left; border: none; background: none; padding: 7px 10px; border-radius: 4px; font-size: 0.85rem; }
  .context-menu button:hover { background: var(--bg); }
  .context-menu button.danger { color: var(--danger); }
  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; font-size: 0.85rem; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5); z-index: 1100; }
</style>
</head>
<body>
<header>
  <h1>ARK Server Manager</h1>
  <select id="server-select"></select>
  <span id="status"></span>
</header>
<main>
  <div id="filters"></div>
  <div class="content-row">
    <section class="panel console-panel">
      <div id="console"></div>
      <form id="rcon-form">
        <input id="rcon-input" placeholder="e.g. Broadcast Hello world" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </section>
    <aside class="panel players-panel">
      <div class="players-header">
        <h3>Online players</h3>
        <span class="players-count" id="players-count">0</span>
      </div>
      <div id="players-list"></div>
    </aside>
  </div>
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
  var filtersEl = document.getElementById('filters');
  var playersListEl = document.getElementById('players-list');
  var playersCountEl = document.getElementById('players-count');
  var contextMenuEl = null;

  function closeContextMenu() {
    if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; }
  }
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('scroll', closeContextMenu, true);

  function showToast(message) {
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 2200);
  }

  // navigator.clipboard is only available in a "secure context" - https, or the
  // literal hostnames localhost/127.0.0.1. Reaching this page via a LAN IP (Settings'
  // Host field set to something other than 127.0.0.1) is plain http from a non-localhost
  // hostname, so the Clipboard API is simply absent there - fall back to the older
  // execCommand('copy') approach via a temporary textarea, which still works.
  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        // fall through - ok stays false, handled below
      }
      textarea.remove();
      if (ok) resolve(); else reject(new Error('Copy command was not available'));
    });
  }

  function showContextMenu(x, y, player) {
    closeContextMenu();
    var menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy ID';
    copyBtn.addEventListener('click', function () {
      copyToClipboard(player.id)
        .then(function () { showToast('Copied ' + player.name + ' ID to clipboard'); })
        .catch(function () { showToast('Could not copy automatically - ID: ' + player.id); });
    });
    menu.appendChild(copyBtn);

    var kickBtn = document.createElement('button');
    kickBtn.className = 'danger';
    kickBtn.textContent = 'Kick';
    kickBtn.addEventListener('click', function () {
      if (!currentId) return;
      if (!confirm('Kick ' + player.name + '?')) return;
      fetch('/api/servers/' + encodeURIComponent(currentId) + '/rcon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'KickPlayer ' + player.id })
      });
    });
    menu.appendChild(kickBtn);

    document.body.appendChild(menu);
    contextMenuEl = menu;
  }

  function loadPlayers() {
    if (!currentId) {
      playersListEl.innerHTML = '';
      playersCountEl.textContent = '0';
      return;
    }
    fetch('/api/servers/' + encodeURIComponent(currentId) + '/players')
      .then(function (r) { return r.json(); })
      .then(function (players) {
        playersCountEl.textContent = String(players.length);
        playersListEl.innerHTML = '';
        if (players.length === 0) {
          var empty = document.createElement('p');
          empty.className = 'empty-state';
          empty.textContent = 'No players connected';
          playersListEl.appendChild(empty);
          return;
        }
        players.forEach(function (p) {
          var row = document.createElement('div');
          row.className = 'player-row';
          row.textContent = p.name;
          row.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, p);
          });
          playersListEl.appendChild(row);
        });
      });
  }

  function loadLabelSettings() {
    fetch('/api/labelsettings').then(function (r) { return r.json(); }).then(function (settings) {
      filtersEl.innerHTML = '';
      var title = document.createElement('span');
      title.textContent = 'Show:';
      filtersEl.appendChild(title);
      Object.keys(settings).forEach(function (label) {
        var wrapper = document.createElement('label');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = settings[label];
        cb.addEventListener('change', function () {
          fetch('/api/labelsettings/' + encodeURIComponent(label), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: cb.checked })
          });
        });
        wrapper.appendChild(cb);
        wrapper.appendChild(document.createTextNode(label));
        filtersEl.appendChild(wrapper);
      });
    });
  }

  function nowTs() {
    return new Date().toTimeString().slice(0, 8);
  }

  var PLAYER_OPEN = String.fromCharCode(1);
  var PLAYER_CLOSE = String.fromCharCode(2);

  // Renders event text as plain text, except for a JOIN/LEFT event's player name (marked
  // with invisible open/close characters by the parser), which gets its own colored span
  // so only that portion picks up the event's color - not the whole line.
  function renderEventText(container, text) {
    var openIdx = text.indexOf(PLAYER_OPEN);
    var closeIdx = text.indexOf(PLAYER_CLOSE);
    if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) {
      container.textContent = text;
      return;
    }
    if (openIdx > 0) container.appendChild(document.createTextNode(text.slice(0, openIdx)));
    var playerSpan = document.createElement('span');
    playerSpan.className = 'player';
    playerSpan.textContent = text.slice(openIdx + 1, closeIdx);
    container.appendChild(playerSpan);
    var after = text.slice(closeIdx + 1);
    if (after) container.appendChild(document.createTextNode(after));
  }

  function addEvent(ev) {
    var div = document.createElement('div');
    div.className = 'log-event log-event-' + ev.cls;
    var ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = ev.ts;
    var label = document.createElement('span'); label.className = 'label'; label.textContent = ev.label;
    var text = document.createElement('span'); text.className = 'text';
    renderEventText(text, ev.text);
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
    loadPlayers();
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
  loadLabelSettings();
  setInterval(loadServers, 5000);
  setInterval(loadPlayers, 5000);
})();
</script>
</body>
</html>
`
