import { describe, expect, it } from 'vitest'
import { appendSample, buildTimeSeriesPoints, selectHistoryWindow } from '../src/renderer/src/lib/sparkline'

describe('appendSample', () => {
  it('appends to an empty history', () => {
    const result = appendSample([], { time: 1000, cpu: 5, memoryMB: 100, players: 1 }, 60000)
    expect(result).toEqual([{ time: 1000, cpu: 5, memoryMB: 100, players: 1 }])
  })

  it('keeps samples still within the window', () => {
    const history = [{ time: 1000, cpu: 1, memoryMB: 1, players: 0 }]
    const result = appendSample(history, { time: 5000, cpu: 2, memoryMB: 2, players: 1 }, 60000)
    expect(result).toHaveLength(2)
    expect(result[0].time).toBe(1000)
    expect(result[1].time).toBe(5000)
  })

  it('drops samples older than the window', () => {
    const history = [
      { time: 1000, cpu: 1, memoryMB: 1, players: 0 },
      { time: 2000, cpu: 1, memoryMB: 1, players: 0 }
    ]
    const result = appendSample(history, { time: 70000, cpu: 3, memoryMB: 3, players: 2 }, 60000)
    expect(result).toEqual([{ time: 70000, cpu: 3, memoryMB: 3, players: 2 }])
  })

  it('does not mutate the input array', () => {
    const history = [{ time: 1000, cpu: 1, memoryMB: 1, players: 0 }]
    appendSample(history, { time: 2000, cpu: 2, memoryMB: 2, players: 1 }, 60000)
    expect(history).toHaveLength(1)
  })
})

describe('selectHistoryWindow', () => {
  const history = [
    { time: 0, cpu: 1, memoryMB: 1, players: 0 },
    { time: 30000, cpu: 2, memoryMB: 2, players: 0 },
    { time: 90000, cpu: 3, memoryMB: 3, players: 0 }
  ]

  it('keeps only samples within the last windowMs relative to now', () => {
    const result = selectHistoryWindow(history, 60000, 90000)
    expect(result).toEqual([history[1], history[2]])
  })

  it('returns everything when the window covers the whole history', () => {
    const result = selectHistoryWindow(history, 3600000, 90000)
    expect(result).toEqual(history)
  })

  it('returns an empty array when nothing falls in the window', () => {
    const result = selectHistoryWindow(history, 1000, 200000)
    expect(result).toEqual([])
  })
})

describe('buildTimeSeriesPoints', () => {
  it('returns an empty string for no samples', () => {
    expect(buildTimeSeriesPoints([], 60000, 60000, 200, 40, 0, 100)).toBe('')
  })

  it('positions a single sample by its actual time within the window, not always at the edge', () => {
    // now=60000, window=60000 -> window start=0. Sample at t=30000 is halfway through.
    const points = buildTimeSeriesPoints([{ time: 30000, value: 50 }], 60000, 60000, 200, 40, 0, 100)
    expect(points).toBe('100.0,20.0')
  })

  it('places a fresh sample (time close to now) near the right edge', () => {
    const points = buildTimeSeriesPoints([{ time: 59000, value: 0 }], 60000, 60000, 200, 40, 0, 100)
    expect(points).toBe('196.7,40.0')
  })

  it('scales multiple samples across the width and height based on elapsed time', () => {
    const samples = [
      { time: 0, value: 0 },
      { time: 30000, value: 50 },
      { time: 60000, value: 100 }
    ]
    const points = buildTimeSeriesPoints(samples, 60000, 60000, 200, 40, 0, 100)
    expect(points).toBe('0.0,40.0 100.0,20.0 200.0,0.0')
  })

  it('clamps a timestamp older than the window start to x=0', () => {
    const points = buildTimeSeriesPoints([{ time: -30000, value: 0 }], 60000, 60000, 200, 40, 0, 100)
    expect(points).toBe('0.0,40.0')
  })

  it('does not divide by zero when min equals max', () => {
    const points = buildTimeSeriesPoints([{ time: 60000, value: 5 }], 60000, 60000, 200, 40, 5, 5)
    expect(points).toBe('200.0,40.0')
  })

  it('clamps a value above max to the top edge (y=0) instead of overflowing above it', () => {
    const points = buildTimeSeriesPoints([{ time: 60000, value: 166 }], 60000, 60000, 200, 40, 0, 100)
    expect(points).toBe('200.0,0.0')
  })

  it('clamps a value below min to the bottom edge (y=height) instead of overflowing below it', () => {
    const points = buildTimeSeriesPoints([{ time: 60000, value: -10 }], 60000, 60000, 200, 40, 0, 100)
    expect(points).toBe('200.0,40.0')
  })
})
