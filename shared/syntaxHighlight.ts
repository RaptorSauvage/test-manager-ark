// Pure line-level syntax-highlighting tokenizer, shared between the desktop Manager's Files
// tab (FilesTab.tsx, rendered via React) and the web dashboard's own Files editor
// (webDashboard.ts's embedded client script, where this same logic is duplicated as plain JS
// since that script is a hand-written string, not a bundled import - see the "Files" section
// there for the mirror of this file). Per-line regex tokenizing rather than a real parser:
// deliberately tolerant of invalid/in-progress JSON (coloring must not break while the user
// is mid-edit), and simple enough to re-run on every keystroke without a noticeable cost.

export type HighlightLanguage = 'ini' | 'json' | 'log' | 'plain'

export type HighlightTokenType =
  | 'plain'
  | 'comment'
  | 'section'
  | 'key'
  | 'punctuation'
  | 'string'
  | 'number'
  | 'boolean'
  | 'timestamp'
  | 'error'
  | 'warn'
  | 'info'

export interface HighlightToken {
  text: string
  type: HighlightTokenType
}

/** Picks a highlighting language from a file's extension - used wherever a file gets opened
 *  in the editor, so the same file always highlights (and opens/saves) the same way on
 *  either surface. */
export function languageForPath(path: string): HighlightLanguage {
  if (/\.ini$/i.test(path)) return 'ini'
  if (/\.json$/i.test(path)) return 'json'
  if (/\.log$/i.test(path)) return 'log'
  return 'plain'
}

const INI_BOOLEAN_RE = /^(true|false)$/i
const NUMBER_RE = /^-?\d+(\.\d+)?$/

function tokenizeIniLine(line: string): HighlightToken[] {
  const trimmed = line.trim()
  if (trimmed.startsWith(';') || trimmed.startsWith('#')) return [{ text: line, type: 'comment' }]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return [{ text: line, type: 'section' }]
  const eq = line.indexOf('=')
  if (eq === -1) return [{ text: line, type: 'plain' }]
  const key = line.slice(0, eq)
  const value = line.slice(eq + 1)
  const valueTrimmed = value.trim()
  const valueType: HighlightTokenType = NUMBER_RE.test(valueTrimmed)
    ? 'number'
    : INI_BOOLEAN_RE.test(valueTrimmed)
      ? 'boolean'
      : 'string'
  return [
    { text: key, type: 'key' },
    { text: '=', type: 'punctuation' },
    { text: value, type: valueType }
  ]
}

// Matches, in priority order: a quoted string, a number, true/false/null, or a single
// punctuation character - whatever's between matches falls through as plain text below.
// The string pattern doesn't special-case an escaped quote (`\"`) inside the string, so a
// value containing one ends its coloring early at that quote - a deliberate simplification
// (this also has to be duplicated as plain JS in webDashboard.ts's client script, where a
// `\\.`-style alternation has its own backslash-escaping hazards - see that file's own
// "Files syntax highlighting" section for why), not something worth a real JSON tokenizer for
// a line-based highlighter.
const JSON_TOKEN_RE = /"[^"]*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]/g

function tokenizeJsonLine(line: string): HighlightToken[] {
  const tokens: HighlightToken[] = []
  let lastIndex = 0
  JSON_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = JSON_TOKEN_RE.exec(line))) {
    if (match.index > lastIndex) tokens.push({ text: line.slice(lastIndex, match.index), type: 'plain' })
    const text = match[0]
    let type: HighlightTokenType
    if (text === '{' || text === '}' || text === '[' || text === ']' || text === ',' || text === ':') {
      type = 'punctuation'
    } else if (text === 'true' || text === 'false' || text === 'null') {
      type = 'boolean'
    } else if (text.startsWith('"')) {
      // A quoted token is a key when the next non-whitespace character after it is a colon -
      // can't tell from the token alone, so check what follows it in the original line.
      type = /^\s*:/.test(line.slice(match.index + text.length)) ? 'key' : 'string'
    } else {
      type = 'number'
    }
    tokens.push({ text, type })
    lastIndex = JSON_TOKEN_RE.lastIndex
  }
  if (lastIndex < line.length) tokens.push({ text: line.slice(lastIndex), type: 'plain' })
  return tokens.length ? tokens : [{ text: line, type: 'plain' }]
}

const LOG_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/
const LOG_LEVEL_RE = /\b(ERROR|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\b/

function tokenizeLogLine(line: string): HighlightToken[] {
  const tokens: HighlightToken[] = []
  let rest = line
  const tsMatch = rest.match(LOG_TIMESTAMP_RE)
  if (tsMatch) {
    tokens.push({ text: tsMatch[0], type: 'timestamp' })
    rest = rest.slice(tsMatch[0].length)
  }
  const levelMatch = rest.match(LOG_LEVEL_RE)
  if (levelMatch && levelMatch.index !== undefined) {
    const before = rest.slice(0, levelMatch.index)
    if (before) tokens.push({ text: before, type: 'plain' })
    const level = levelMatch[0].toUpperCase()
    const type: HighlightTokenType =
      level === 'ERROR' || level === 'FATAL' ? 'error' : level === 'WARN' || level === 'WARNING' ? 'warn' : 'info'
    tokens.push({ text: levelMatch[0], type })
    rest = rest.slice(levelMatch.index + levelMatch[0].length)
  }
  if (rest) tokens.push({ text: rest, type: 'plain' })
  return tokens.length ? tokens : [{ text: line, type: 'plain' }]
}

export function tokenizeLine(line: string, language: HighlightLanguage): HighlightToken[] {
  switch (language) {
    case 'ini':
      return tokenizeIniLine(line)
    case 'json':
      return tokenizeJsonLine(line)
    case 'log':
      return tokenizeLogLine(line)
    default:
      return [{ text: line, type: 'plain' }]
  }
}
