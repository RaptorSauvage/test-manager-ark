import { describe, expect, it } from 'vitest'
import { parseGameVersionFromTitle, getWindowTitle, getGameVersion } from '../src/main/lib/serverVersion'

describe('parseGameVersionFromTitle', () => {
  it('extracts the version from a real ARK:SA console title', () => {
    const title =
      'ASA 92.28 | [Aberration] Culte de Bober | Aberration_WP | PvP | Process 125696 | Players: 0/70 | Mem: 7.7 GB'
    expect(parseGameVersionFromTitle(title)).toBe('92.28')
  })

  it('handles a version with more than two segments', () => {
    expect(parseGameVersionFromTitle('ASA 1.2.3 | Session')).toBe('1.2.3')
  })

  it('tolerates leading/trailing whitespace', () => {
    expect(parseGameVersionFromTitle('  ASA 92.28 | Session  ')).toBe('92.28')
  })

  it('returns null for a title that does not start with "ASA <version>"', () => {
    expect(parseGameVersionFromTitle('Some Other Window')).toBeNull()
    expect(parseGameVersionFromTitle('')).toBeNull()
  })
})

describe('getWindowTitle', () => {
  it('resolves to null on non-Windows platforms without spawning anything', async () => {
    if (process.platform === 'win32') return
    expect(await getWindowTitle(1234)).toBeNull()
  })

  it('resolves to null for a non-positive or non-integer pid', async () => {
    expect(await getWindowTitle(0)).toBeNull()
    expect(await getWindowTitle(-1)).toBeNull()
    expect(await getWindowTitle(1.5)).toBeNull()
  })
})

describe('getGameVersion', () => {
  it('resolves to null when there is no window title to parse (e.g. non-Windows)', async () => {
    if (process.platform === 'win32') return
    expect(await getGameVersion(1234)).toBeNull()
  })
})
