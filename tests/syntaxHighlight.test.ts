import { describe, expect, it } from 'vitest'
import { languageForPath, tokenizeLine } from '../shared/syntaxHighlight'

describe('languageForPath', () => {
  it('maps extensions to their language, case-insensitively', () => {
    expect(languageForPath('GameUserSettings.ini')).toBe('ini')
    expect(languageForPath('Game.INI')).toBe('ini')
    expect(languageForPath('curseforge_config.json')).toBe('json')
    expect(languageForPath('config.JSON')).toBe('json')
    expect(languageForPath('ShooterGame.log')).toBe('log')
    expect(languageForPath('ShooterGame.LOG')).toBe('log')
    expect(languageForPath('run.bat')).toBe('plain')
  })
})

describe('tokenizeLine - ini', () => {
  it('colors a section header as one token', () => {
    expect(tokenizeLine('[/script/shootergame.shootergamemode]', 'ini')).toEqual([
      { text: '[/script/shootergame.shootergamemode]', type: 'section' }
    ])
  })

  it('colors a comment line as one token', () => {
    expect(tokenizeLine(';Breeding', 'ini')).toEqual([{ text: ';Breeding', type: 'comment' }])
    expect(tokenizeLine('# also a comment', 'ini')).toEqual([{ text: '# also a comment', type: 'comment' }])
  })

  it('splits a key=value line into key/punctuation/value', () => {
    expect(tokenizeLine('BabyMatureSpeedMultiplier=30', 'ini')).toEqual([
      { text: 'BabyMatureSpeedMultiplier', type: 'key' },
      { text: '=', type: 'punctuation' },
      { text: '30', type: 'number' }
    ])
  })

  it('recognizes True/False values as booleans, case-insensitively', () => {
    expect(tokenizeLine('bDisableLootCrates=False', 'ini')).toEqual([
      { text: 'bDisableLootCrates', type: 'key' },
      { text: '=', type: 'punctuation' },
      { text: 'False', type: 'boolean' }
    ])
  })

  it('treats a non-numeric, non-boolean value as a string', () => {
    expect(tokenizeLine('SessionName=My Server', 'ini')).toEqual([
      { text: 'SessionName', type: 'key' },
      { text: '=', type: 'punctuation' },
      { text: 'My Server', type: 'string' }
    ])
  })

  it('leaves a line with no "=" as plain', () => {
    expect(tokenizeLine('Breeding', 'ini')).toEqual([{ text: 'Breeding', type: 'plain' }])
  })
})

describe('tokenizeLine - json', () => {
  it('distinguishes a key from a string value', () => {
    expect(tokenizeLine('  "name": "value",', 'json')).toEqual([
      { text: '  ', type: 'plain' },
      { text: '"name"', type: 'key' },
      { text: ':', type: 'punctuation' },
      { text: ' ', type: 'plain' },
      { text: '"value"', type: 'string' },
      { text: ',', type: 'punctuation' }
    ])
  })

  it('colors numbers and booleans/null', () => {
    expect(tokenizeLine('  "count": 42, "ok": true, "x": null', 'json')).toEqual([
      { text: '  ', type: 'plain' },
      { text: '"count"', type: 'key' },
      { text: ':', type: 'punctuation' },
      { text: ' ', type: 'plain' },
      { text: '42', type: 'number' },
      { text: ',', type: 'punctuation' },
      { text: ' ', type: 'plain' },
      { text: '"ok"', type: 'key' },
      { text: ':', type: 'punctuation' },
      { text: ' ', type: 'plain' },
      { text: 'true', type: 'boolean' },
      { text: ',', type: 'punctuation' },
      { text: ' ', type: 'plain' },
      { text: '"x"', type: 'key' },
      { text: ':', type: 'punctuation' },
      { text: ' ', type: 'plain' },
      { text: 'null', type: 'boolean' }
    ])
  })

  it('does not break on an incomplete/invalid line - unmatched text falls through as plain', () => {
    expect(tokenizeLine('  "unterminated', 'json')).toEqual([{ text: '  "unterminated', type: 'plain' }])
  })

  it('colors braces and brackets as punctuation', () => {
    expect(tokenizeLine('{', 'json')).toEqual([{ text: '{', type: 'punctuation' }])
    expect(tokenizeLine('  ]', 'json')).toEqual([
      { text: '  ', type: 'plain' },
      { text: ']', type: 'punctuation' }
    ])
  })
})

describe('tokenizeLine - log', () => {
  it('colors a leading timestamp and a log level', () => {
    expect(tokenizeLine('2026-10-20T23:45:17.532Z [ERROR] something broke', 'log')).toEqual([
      { text: '2026-10-20T23:45:17.532Z', type: 'timestamp' },
      { text: ' [', type: 'plain' },
      { text: 'ERROR', type: 'error' },
      { text: '] something broke', type: 'plain' }
    ])
  })

  it('colors WARN/WARNING as warn and INFO/DEBUG/TRACE as info', () => {
    expect(tokenizeLine('WARNING: low disk space', 'log')).toEqual([
      { text: 'WARNING', type: 'warn' },
      { text: ': low disk space', type: 'plain' }
    ])
    expect(tokenizeLine('DEBUG starting up', 'log')).toEqual([
      { text: 'DEBUG', type: 'info' },
      { text: ' starting up', type: 'plain' }
    ])
  })

  it('is plain when there is no timestamp or level', () => {
    expect(tokenizeLine('just some text', 'log')).toEqual([{ text: 'just some text', type: 'plain' }])
  })
})

describe('tokenizeLine - plain', () => {
  it('returns the whole line as a single plain token', () => {
    expect(tokenizeLine('anything at all', 'plain')).toEqual([{ text: 'anything at all', type: 'plain' }])
  })
})
