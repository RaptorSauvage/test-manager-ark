import { describe, expect, it } from 'vitest'
import { buildTimeSeriesPath, loadStoredScale, saveStoredScale, STATS_TIME_SCALES } from '../src/renderer/src/lib/sparkline'

describe('buildTimeSeriesPath', () => {
  it('returns an empty string for no samples', () => {
    expect(buildTimeSeriesPath([], 60000, 60000, 200, 40, 0, 100)).toBe('')
  })

  it('positions a single sample by its actual time within the window, not always at the edge', () => {
    // now=60000, window=60000 -> window start=0. Sample at t=30000 is halfway through.
    const path = buildTimeSeriesPath([{ time: 30000, value: 50 }], 60000, 60000, 200, 40, 0, 100)
    expect(path).toBe('M100.0,20.0')
  })

  it('places a fresh sample (time close to now) near the right edge', () => {
    const path = buildTimeSeriesPath([{ time: 59000, value: 0 }], 60000, 60000, 200, 40, 0, 100)
    expect(path).toBe('M196.7,40.0')
  })

  it('scales multiple samples across the width and height based on elapsed time, connected by line-to commands', () => {
    const samples = [
      { time: 0, value: 0 },
      { time: 30000, value: 50 },
      { time: 60000, value: 100 }
    ]
    const path = buildTimeSeriesPath(samples, 60000, 60000, 200, 40, 0, 100)
    expect(path).toBe('M0.0,40.0 L100.0,20.0 L200.0,0.0')
  })

  it('clamps a timestamp older than the window start to x=0', () => {
    const path = buildTimeSeriesPath([{ time: -30000, value: 0 }], 60000, 60000, 200, 40, 0, 100)
    expect(path).toBe('M0.0,40.0')
  })

  it('does not divide by zero when min equals max', () => {
    const path = buildTimeSeriesPath([{ time: 60000, value: 5 }], 60000, 60000, 200, 40, 5, 5)
    expect(path).toBe('M200.0,40.0')
  })

  it('clamps a value above max to the top edge (y=0) instead of overflowing above it', () => {
    const path = buildTimeSeriesPath([{ time: 60000, value: 166 }], 60000, 60000, 200, 40, 0, 100)
    expect(path).toBe('M200.0,0.0')
  })

  it('clamps a value below min to the bottom edge (y=height) instead of overflowing below it', () => {
    const path = buildTimeSeriesPath([{ time: 60000, value: -10 }], 60000, 60000, 200, 40, 0, 100)
    expect(path).toBe('M200.0,40.0')
  })

  it('breaks the line into a new subpath when the gap to the previous sample exceeds maxGapMs', () => {
    const samples = [
      { time: 0, value: 0 },
      // 70s gap, over the 60s default - should NOT be connected to the previous point
      { time: 70000, value: 100 }
    ]
    const path = buildTimeSeriesPath(samples, 100000, 100000, 200, 40, 0, 100)
    expect(path).toBe('M0.0,40.0 M140.0,0.0')
  })

  it('keeps the line connected when the gap is under maxGapMs', () => {
    const samples = [
      { time: 0, value: 0 },
      { time: 50000, value: 100 }
    ]
    const path = buildTimeSeriesPath(samples, 100000, 100000, 200, 40, 0, 100)
    expect(path).toBe('M0.0,40.0 L100.0,0.0')
  })

  it('respects a custom maxGapMs', () => {
    const samples = [
      { time: 0, value: 0 },
      { time: 10000, value: 100 }
    ]
    const path = buildTimeSeriesPath(samples, 100000, 100000, 200, 40, 0, 100, 5000)
    expect(path).toBe('M0.0,40.0 M20.0,0.0')
  })
})

describe('STATS_TIME_SCALES', () => {
  it('offers 6h/12h/24h/All, with All represented as ms: null', () => {
    expect(STATS_TIME_SCALES.map((s) => s.label)).toEqual(['6h', '12h', '24h', 'All'])
    expect(STATS_TIME_SCALES.find((s) => s.label === 'All')?.ms).toBeNull()
    expect(STATS_TIME_SCALES.find((s) => s.label === '6h')?.ms).toBe(6 * 60 * 60 * 1000)
  })
})

describe('loadStoredScale', () => {
  // This test suite runs in a plain Node environment (no jsdom/localStorage) - these two
  // functions are written to degrade gracefully rather than throw when storage isn't
  // available at all, so this exercises exactly that path (a real browser round-trip isn't
  // reachable from here).
  it('falls back to the given default when localStorage is unavailable', () => {
    expect(loadStoredScale('some-key', STATS_TIME_SCALES[2].ms)).toBe(STATS_TIME_SCALES[2].ms)
  })

  it('does not throw when asked to save with no localStorage available', () => {
    expect(() => saveStoredScale('some-key', null)).not.toThrow()
  })
})
