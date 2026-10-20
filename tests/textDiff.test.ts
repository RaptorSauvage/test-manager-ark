import { describe, expect, it } from 'vitest'
import { computeLineDiff, MAX_DIFF_LINES } from '../shared/textDiff'

describe('computeLineDiff', () => {
  it('returns all-same lines for identical text', () => {
    const text = 'A\nB\nC'
    expect(computeLineDiff(text, text)).toEqual([
      { type: 'same', text: 'A' },
      { type: 'same', text: 'B' },
      { type: 'same', text: 'C' }
    ])
  })

  it('marks a single changed line as removed+added, not every line after it', () => {
    const oldText = 'A\nB\nC\nD'
    const newText = 'A\nX\nC\nD'
    expect(computeLineDiff(oldText, newText)).toEqual([
      { type: 'same', text: 'A' },
      { type: 'removed', text: 'B' },
      { type: 'added', text: 'X' },
      { type: 'same', text: 'C' },
      { type: 'same', text: 'D' }
    ])
  })

  it('does not mark every remaining line as changed after an inserted line', () => {
    const oldText = 'A\nB\nC'
    const newText = 'A\nNEW\nB\nC'
    expect(computeLineDiff(oldText, newText)).toEqual([
      { type: 'same', text: 'A' },
      { type: 'added', text: 'NEW' },
      { type: 'same', text: 'B' },
      { type: 'same', text: 'C' }
    ])
  })

  it('marks a deleted line as removed with everything else unchanged', () => {
    const oldText = 'A\nB\nC'
    const newText = 'A\nC'
    expect(computeLineDiff(oldText, newText)).toEqual([
      { type: 'same', text: 'A' },
      { type: 'removed', text: 'B' },
      { type: 'same', text: 'C' }
    ])
  })

  it('marks every line as added when growing from an empty file', () => {
    expect(computeLineDiff('', 'A\nB')).toEqual([
      { type: 'removed', text: '' },
      { type: 'added', text: 'A' },
      { type: 'added', text: 'B' }
    ])
  })

  it('returns null instead of diffing when either side exceeds MAX_DIFF_LINES', () => {
    const huge = new Array(MAX_DIFF_LINES + 1).fill('x').join('\n')
    expect(computeLineDiff(huge, 'a')).toBeNull()
    expect(computeLineDiff('a', huge)).toBeNull()
  })
})
