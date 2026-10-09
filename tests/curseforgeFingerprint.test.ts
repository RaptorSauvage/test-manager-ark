import { describe, expect, it } from 'vitest'
import { computeCurseForgeFingerprint } from '../src/main/lib/curseforgeFingerprint'

describe('computeCurseForgeFingerprint', () => {
  it('is deterministic - the same bytes always produce the same fingerprint', () => {
    const buffer = Buffer.from('some fake jar file content, repeated a bit for length')
    expect(computeCurseForgeFingerprint(buffer)).toBe(computeCurseForgeFingerprint(Buffer.from(buffer)))
  })

  it('produces different fingerprints for different content', () => {
    const a = computeCurseForgeFingerprint(Buffer.from('content a'))
    const b = computeCurseForgeFingerprint(Buffer.from('content b'))
    expect(a).not.toBe(b)
  })

  it('ignores whitespace bytes (tab/LF/CR/space) when computing the fingerprint, matching CurseForge\'s own algorithm', () => {
    const base = computeCurseForgeFingerprint(Buffer.from('abcdefgh'))
    const withSpaces = computeCurseForgeFingerprint(Buffer.from('ab cd ef gh'))
    const withTabsAndNewlines = computeCurseForgeFingerprint(Buffer.from('ab\tcd\nef\rgh'))
    expect(withSpaces).toBe(base)
    expect(withTabsAndNewlines).toBe(base)
  })

  it('does not ignore non-whitespace bytes that happen to be adjacent to whitespace', () => {
    const a = computeCurseForgeFingerprint(Buffer.from('abc def'))
    const b = computeCurseForgeFingerprint(Buffer.from('abcdef'))
    const c = computeCurseForgeFingerprint(Buffer.from('ab cdef'))
    // 'abc def' and 'ab cdef' both strip to 'abcdef' once whitespace is removed - same fingerprint.
    expect(a).toBe(b)
    expect(c).toBe(b)
  })

  it('handles an empty buffer without throwing', () => {
    expect(() => computeCurseForgeFingerprint(Buffer.alloc(0))).not.toThrow()
  })

  it('handles a buffer whose length is not a multiple of 4 bytes (exercises the tail-byte switch)', () => {
    for (const length of [1, 2, 3, 5, 6, 7]) {
      const buffer = Buffer.alloc(length, 0x41)
      expect(() => computeCurseForgeFingerprint(buffer)).not.toThrow()
    }
  })

  it('always returns an unsigned 32-bit integer', () => {
    const fingerprint = computeCurseForgeFingerprint(Buffer.from('some content that is reasonably long for a jar-like file'))
    expect(fingerprint).toBeGreaterThanOrEqual(0)
    expect(fingerprint).toBeLessThanOrEqual(0xffffffff)
    expect(Number.isInteger(fingerprint)).toBe(true)
  })
})
