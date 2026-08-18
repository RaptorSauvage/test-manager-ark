import { describe, expect, it } from 'vitest'
import { appendSample, buildSparklinePoints } from '../src/renderer/src/lib/sparkline'

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

describe('buildSparklinePoints', () => {
  it('returns an empty string for no values', () => {
    expect(buildSparklinePoints([], 200, 40, 0, 100)).toBe('')
  })

  it('renders a single value as a flat line at the right edge', () => {
    expect(buildSparklinePoints([50], 200, 40, 0, 100)).toBe('200.0,20.0')
  })

  it('scales multiple values linearly across the width and height', () => {
    const points = buildSparklinePoints([0, 50, 100], 200, 40, 0, 100)
    expect(points).toBe('0.0,40.0 100.0,20.0 200.0,0.0')
  })

  it('does not divide by zero when min equals max', () => {
    const points = buildSparklinePoints([5, 5, 5], 200, 40, 5, 5)
    expect(points).toBe('0.0,40.0 100.0,40.0 200.0,40.0')
  })
})
