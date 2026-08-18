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
 * Restricts `history` to samples within the last `windowMs` relative to `now` - used to
 * derive what a selected time scale (1m/5m/30m/1h) should actually display out of the
 * full collected history.
 */
export function selectHistoryWindow(history: StatSample[], windowMs: number, now: number): StatSample[] {
  const cutoff = now - windowMs
  return history.filter((s) => s.time >= cutoff)
}

/**
 * Maps timestamped values onto an SVG polyline `points` string, positioning each point by
 * where its timestamp actually falls within [now - windowMs, now] rather than spacing points
 * evenly by index. This way a window that isn't fully populated yet (e.g. a server that just
 * started, viewed against a 1h time scale) only draws a line across the portion of the width
 * that has real data instead of stretching a handful of samples across the full width.
 * A zero/negative value range is treated as 1 so a perfectly flat series still renders as a
 * flat line instead of dividing by zero.
 */
export function buildTimeSeriesPoints(
  samples: Array<{ time: number; value: number }>,
  windowMs: number,
  now: number,
  width: number,
  height: number,
  min: number,
  max: number
): string {
  if (samples.length === 0) return ''
  const range = max - min || 1
  const start = now - windowMs
  const span = windowMs || 1
  return samples
    .map((s) => {
      const x = Math.max(0, Math.min(width, ((s.time - start) / span) * width))
      const y = height - ((s.value - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
