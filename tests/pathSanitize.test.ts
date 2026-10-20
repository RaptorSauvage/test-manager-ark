import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripWrappingQuotes, resolveSafePath } from '../src/main/lib/pathSanitize'

describe('stripWrappingQuotes', () => {
  it('strips a wrapping pair of double quotes, as pasted from Explorer\'s "Copy as path"', () => {
    expect(stripWrappingQuotes('"C:\\ARK\\Server"')).toBe('C:\\ARK\\Server')
  })

  it('trims surrounding whitespace even without quotes', () => {
    expect(stripWrappingQuotes('  C:\\ARK\\Server  ')).toBe('C:\\ARK\\Server')
  })

  it('trims whitespace outside the quotes too', () => {
    expect(stripWrappingQuotes('  "C:\\ARK\\Server"  ')).toBe('C:\\ARK\\Server')
  })

  it('leaves an unquoted path untouched', () => {
    expect(stripWrappingQuotes('C:\\ARK\\Server')).toBe('C:\\ARK\\Server')
  })

  it('leaves a lone quote character untouched rather than stripping to nothing', () => {
    expect(stripWrappingQuotes('"')).toBe('"')
  })

  it('leaves an empty string untouched', () => {
    expect(stripWrappingQuotes('')).toBe('')
  })

  it('does not strip a quote that only appears on one side', () => {
    expect(stripWrappingQuotes('"C:\\ARK\\Server')).toBe('"C:\\ARK\\Server')
    expect(stripWrappingQuotes('C:\\ARK\\Server"')).toBe('C:\\ARK\\Server"')
  })
})

describe('resolveSafePath', () => {
  const base = path.resolve('/tmp/ark-install-dir')

  it('resolves a plain relative path inside the base directory', () => {
    expect(resolveSafePath(base, 'ShooterGame/Saved/Config')).toBe(path.join(base, 'ShooterGame', 'Saved', 'Config'))
  })

  it('resolves the base directory itself for an empty relative path', () => {
    expect(resolveSafePath(base, '')).toBe(base)
  })

  it('throws on a path that escapes the base directory with ../', () => {
    expect(() => resolveSafePath(base, '../../etc/passwd')).toThrow('Invalid path')
  })

  it('throws on a path that escapes only after a deeper descent', () => {
    expect(() => resolveSafePath(base, 'ShooterGame/../../../etc/passwd')).toThrow('Invalid path')
  })

  it('throws on an absolute path instead of silently replacing the base directory', () => {
    expect(() => resolveSafePath(base, '/etc/passwd')).toThrow('Invalid path')
  })

  it('throws on a Windows absolute path with a drive letter', () => {
    expect(() => resolveSafePath(base, 'C:\\Windows\\System32')).toThrow('Invalid path')
  })

  it('does not false-positive on a sibling directory that merely shares a name prefix', () => {
    // A naive `resolved.startsWith(base)` check (without the path.sep above) would wrongly
    // let this through, since '/tmp/ark-install-dir-evil' starts with '/tmp/ark-install-dir'.
    expect(() => resolveSafePath(base, '../ark-install-dir-evil/secret.txt')).toThrow('Invalid path')
  })
})
