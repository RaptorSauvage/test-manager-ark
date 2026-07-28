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
