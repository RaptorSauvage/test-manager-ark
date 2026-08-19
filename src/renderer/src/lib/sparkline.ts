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

/** A gap this long (or longer) between two consecutive samples breaks the line instead of
 *  connecting them - at the normal 5s sample cadence this only trips when samples were
 *  actually missed (server stopped, Manager closed, stats disabled for a while), not on
 *  ordinary jitter. */
export const MAX_CONTINUOUS_GAP_MS = 60_000

/**
 * Maps timestamped values onto an SVG `<path>` `d` string, positioning each point by where
 * its timestamp actually falls within [now - windowMs, now] rather than spacing points evenly
 * by index. This way a window that isn't fully populated yet (e.g. a server that just
 * started, viewed against a 1h time scale) only draws a line across the portion of the width
 * that has real data instead of stretching a handful of samples across the full width.
 * Whenever two consecutive samples are more than `maxGapMs` apart, the path starts a new
 * subpath (`M` instead of `L`) instead of drawing a straight line across the gap - otherwise
 * a server that was stopped for a while (or had stats disabled, or just wasn't sampled
 * because the Manager was closed) would show a misleading diagonal slope bridging two
 * readings that aren't actually part of the same continuous run.
 * A zero/negative value range is treated as 1 so a perfectly flat series still renders as a
 * flat line instead of dividing by zero. y is clamped to [0, height] so a value outside
 * [min, max] (the caller's `max` is usually derived from the data itself, but CPU in
 * particular can exceed 100% on a multi-core process) still draws at the row's edge instead
 * of overflowing outside it.
 */
export function buildTimeSeriesPath(
  samples: Array<{ time: number; value: number }>,
  windowMs: number,
  now: number,
  width: number,
  height: number,
  min: number,
  max: number,
  maxGapMs: number = MAX_CONTINUOUS_GAP_MS
): string {
  if (samples.length === 0) return ''
  const range = max - min || 1
  const start = now - windowMs
  const span = windowMs || 1
  let d = ''
  let previousTime: number | null = null
  for (const s of samples) {
    const x = Math.max(0, Math.min(width, ((s.time - start) / span) * width))
    const y = Math.max(0, Math.min(height, height - ((s.value - min) / range) * height))
    const command = previousTime === null || s.time - previousTime > maxGapMs ? 'M' : 'L'
    d += `${command}${x.toFixed(1)},${y.toFixed(1)} `
    previousTime = s.time
  }
  return d.trim()
}
