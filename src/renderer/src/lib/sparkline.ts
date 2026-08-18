export interface StatSample {
  time: number
  cpu: number
  memoryMB: number
  players: number
}

/**
 * Drops samples older than `windowMs` relative to `sample.time`, then appends `sample` -
 * keeps the rolling window capped so a chart for a server that's been running for hours
 * doesn't accumulate an ever-growing array.
 */
export function appendSample(history: StatSample[], sample: StatSample, windowMs: number): StatSample[] {
  const cutoff = sample.time - windowMs
  return [...history.filter((s) => s.time >= cutoff), sample]
}

/**
 * Maps a series of numbers onto an SVG polyline `points` string across a width x height
 * viewBox, scaling linearly between `min` and `max` (a zero/negative range is treated as
 * 1 so a perfectly flat series still renders as a flat line instead of dividing by zero).
 * A single sample renders as a flat line at the right edge rather than a single dot, so a
 * server that just started still shows something readable.
 */
export function buildSparklinePoints(
  values: number[],
  width: number,
  height: number,
  min: number,
  max: number
): string {
  if (values.length === 0) return ''
  const range = max - min || 1
  return values
    .map((v, i) => {
      const x = values.length === 1 ? width : (i / (values.length - 1)) * width
      const y = height - ((v - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
