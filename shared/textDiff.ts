// Pure line-diff math, shared between the main process (which computes a diff for the
// web dashboard's config history routes - see webDashboard.ts's /ini/history/diff route)
// and nothing else yet, but kept here rather than inline so it stays independently testable.

export interface DiffLine {
  type: 'same' | 'added' | 'removed'
  text: string
}

/** Above this many lines on either side, the classic O(n*m) LCS table below would mean
 *  allocating tens of millions of array cells for a file nobody would read as a diff anyway
 *  - callers should treat `null` as "too large to diff" rather than something to retry. */
export const MAX_DIFF_LINES = 2000

/**
 * Line-level diff via the classic LCS (longest common subsequence) dynamic-programming
 * table - correct for small-to-medium text (a .ini file is never going to be large enough
 * for O(n*m) to matter), unlike a naive index-by-index comparison which would mark every
 * line as changed after a single inserted/deleted line shifts everything below it.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] | null {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) return null

  const n = oldLines.length
  const m = newLines.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'same', text: oldLines[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'removed', text: oldLines[i] })
      i++
    } else {
      result.push({ type: 'added', text: newLines[j] })
      j++
    }
  }
  while (i < n) {
    result.push({ type: 'removed', text: oldLines[i] })
    i++
  }
  while (j < m) {
    result.push({ type: 'added', text: newLines[j] })
    j++
  }
  return result
}
