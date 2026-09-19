import type { StatSample } from '@shared/types'

export type { StatSample }

/** A gap this long (or longer) between two consecutive samples breaks the line instead of
 *  connecting them - at the normal 5s sample cadence this only trips when samples were
 *  actually missed (server stopped, Manager closed, stats disabled for a while), not on
 *  ordinary jitter. Charts fed pre-bucketed history (see statsHistory.ts) should compute
 *  their own gap threshold from the actual bucket width used instead of relying on this
 *  default, which assumes raw ~5s samples. */
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

/** Time scale choices for the Server Statistics chart (Analytics tab) and the Cluster
 *  Dashboard chart alike - `ms: null` means "All" (every recorded sample, no lower time
 *  bound), the one scale that isn't a fixed window. */
export interface StatsTimeScale {
  label: string
  ms: number | null
}

export const STATS_TIME_SCALES: StatsTimeScale[] = [
  { label: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '12h', ms: 12 * 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: 'All', ms: null }
]

function serializeScale(ms: number | null): string {
  return ms === null ? 'null' : String(ms)
}

/** Reads back a scale previously saved by saveStoredScale - falls back to `fallbackMs` if
 *  nothing's stored yet, or if what's stored no longer matches one of STATS_TIME_SCALES
 *  (e.g. an older version of this app persisted a now-removed scale like "1m"). */
export function loadStoredScale(key: string, fallbackMs: number | null): number | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return fallbackMs
  }
  if (raw === null) return fallbackMs
  const parsed = raw === 'null' ? null : Number(raw)
  if (parsed !== null && !Number.isFinite(parsed)) return fallbackMs
  return STATS_TIME_SCALES.some((scale) => scale.ms === parsed) ? parsed : fallbackMs
}

export function saveStoredScale(key: string, ms: number | null): void {
  try {
    localStorage.setItem(key, serializeScale(ms))
  } catch {
    // Storage unavailable (private browsing, quota) - not fatal, just won't persist.
  }
}
