import path from 'node:path'

/**
 * Strips whitespace and a wrapping pair of double quotes from a pasted path. Windows
 * Explorer's "Copy as path" wraps the result in literal `"..."` quotes - pasted verbatim
 * into a plain text field (like Settings' Install directory, which has no folder picker),
 * the quotes become part of the stored path and every `fs`/`path.join` call built on top
 * of it silently fails to find anything, even though the folder is genuinely there.
 */
export function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/**
 * Joins `relativePath` onto `baseDir` and verifies the result actually stays inside it -
 * for the web dashboard's file browser (webDashboard.ts), where `relativePath` comes
 * straight from a remote HTTP request and must never be trusted to resolve where it claims
 * to. `path.join` alone would happily resolve `../../etc/passwd` right out of `baseDir`;
 * this throws instead of returning a path outside it. An absolute `relativePath` (Windows
 * drive letter or POSIX leading slash) is rejected outright rather than silently replacing
 * `baseDir`, which is exactly what `path.join`/`path.resolve` would otherwise do with one.
 */
export function resolveSafePath(baseDir: string, relativePath: string): string {
  // path.isAbsolute alone isn't enough: it only recognizes the *current* platform's own
  // absolute-path syntax (e.g. running this on Linux in tests/CI would let a Windows-style
  // "C:\Windows\System32" sail right through as "not absolute"). The app itself only ever
  // ships on Windows, but checking both syntaxes unconditionally means this one security
  // check can never quietly depend on which OS actually ran it.
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:[/\\]/.test(relativePath) || /^\\\\/.test(relativePath)) {
    throw new Error('Invalid path')
  }
  const resolvedBase = path.resolve(baseDir)
  const resolved = path.resolve(resolvedBase, relativePath)
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error('Invalid path')
  }
  return resolved
}
