import { describe, expect, it } from 'vitest'
import { curseforgeHtmlToText, curseforgeSplitChangelog, extractVersion } from '../src/bot/curseforge'

describe('curseforgeHtmlToText', () => {
  it('returns a placeholder for empty/missing input', () => {
    expect(curseforgeHtmlToText(null)).toBe('*(Aucun changelog fourni pour ce fichier)*')
    expect(curseforgeHtmlToText(undefined)).toBe('*(Aucun changelog fourni pour ce fichier)*')
    expect(curseforgeHtmlToText('')).toBe('*(Aucun changelog fourni pour ce fichier)*')
  })

  it('converts bold, italic, underline and strikethrough', () => {
    expect(curseforgeHtmlToText('<strong>bold</strong>')).toBe('**bold**')
    expect(curseforgeHtmlToText('<b>bold</b>')).toBe('**bold**')
    expect(curseforgeHtmlToText('<em>italic</em>')).toBe('*italic*')
    expect(curseforgeHtmlToText('<i>italic</i>')).toBe('*italic*')
    expect(curseforgeHtmlToText('<u>underline</u>')).toBe('__underline__')
    expect(curseforgeHtmlToText('<s>strike</s>')).toBe('~~strike~~')
    expect(curseforgeHtmlToText('<del>strike</del>')).toBe('~~strike~~')
  })

  it('converts links to Discord markdown', () => {
    expect(curseforgeHtmlToText('<a href="https://example.com">link text</a>')).toBe('[link text](https://example.com)')
  })

  it('converts code blocks and inline code', () => {
    expect(curseforgeHtmlToText('<pre>const x = 1</pre>')).toBe('```\nconst x = 1\n```')
    expect(curseforgeHtmlToText('<code>inline</code>')).toBe('`inline`')
  })

  it('converts headers to bold lines and lists to bullet points', () => {
    expect(curseforgeHtmlToText('<h2>Title</h2>')).toBe('**Title**')
    expect(curseforgeHtmlToText('<ul><li>one</li><li>two</li></ul>')).toBe('• one\n• two')
  })

  it('decodes common HTML entities', () => {
    expect(curseforgeHtmlToText('Fix &amp; improve &lt;feature&gt;')).toBe('Fix & improve <feature>')
    expect(curseforgeHtmlToText('It&#39;s here')).toBe("It's here")
  })

  it('collapses runs of blank lines and trims the result', () => {
    expect(curseforgeHtmlToText('<p>one</p><p>two</p>')).toBe('one\n\ntwo')
  })

  it('returns a placeholder when the result is empty after stripping tags', () => {
    expect(curseforgeHtmlToText('<div></div>')).toBe('*(Changelog vide)*')
  })
})

describe('curseforgeSplitChangelog', () => {
  it('returns the text unchanged when under the chunk size', () => {
    expect(curseforgeSplitChangelog('short text', 100)).toEqual(['short text'])
  })

  it('splits on newlines once the chunk size is exceeded', () => {
    const text = `${'a'.repeat(50)}\n${'b'.repeat(50)}\n${'c'.repeat(50)}`
    const parts = curseforgeSplitChangelog(text, 60)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('\n')).toBe(text)
  })

  it('force-splits a single line longer than the chunk size on its own', () => {
    const line = 'x'.repeat(250)
    const parts = curseforgeSplitChangelog(line, 100)
    expect(parts).toEqual(['x'.repeat(100), 'x'.repeat(100), 'x'.repeat(50)])
  })
})

describe('extractVersion', () => {
  it('prefers a number directly preceded by v/V', () => {
    expect(extractVersion('Mod_v99.zip', undefined)).toBe('99')
    expect(extractVersion(undefined, 'Mod_V12.jar')).toBe('12')
  })

  it('falls back to the last number in the text when there is no v-prefixed one', () => {
    expect(extractVersion('Release 2024-10-11 build 42', undefined)).toBe('42')
  })

  it('falls back to the raw name when there is no number at all', () => {
    expect(extractVersion('MyMod', undefined)).toBe('MyMod')
  })
})
