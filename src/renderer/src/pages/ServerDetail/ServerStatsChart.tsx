import { useRef, useState, type MouseEvent } from 'react'
import { buildTimeSeriesPath, MAX_CONTINUOUS_GAP_MS, type StatSample } from '../../lib/sparkline'

const CHART_WIDTH = 1000
const CHART_HEIGHT = 60

/** The tooltip is normally centered on the hovered point (`translateX(-50%)`), but that
 *  pushes it half its own width past the chart's edge - and off the edge of whatever clips
 *  it (a rounded card, in the Cluster Dashboard's case) - when hovering close to either
 *  side. Past these thresholds it anchors to the near edge instead, growing inward, so it
 *  stays fully visible right up to x=0% and x=100%. */
const TOOLTIP_EDGE_PERCENT = 12

function tooltipTransform(xPercent: number): string {
  if (xPercent < TOOLTIP_EDGE_PERCENT) return 'translateX(0)'
  if (xPercent > 100 - TOOLTIP_EDGE_PERCENT) return 'translateX(-100%)'
  return 'translateX(-50%)'
}

interface HoverState {
  xPercent: number
  time: number
  value: number
}

interface SparklineProps {
  label: string
  unit: string
  current: number | undefined
  samples: Array<{ time: number; value: number }>
  windowMs: number
  now: number
  color: string
  max: number
  maxGapMs: number
}

function Sparkline({ label, unit, current, samples, windowMs, now, color, max, maxGapMs }: SparklineProps): JSX.Element {
  const pathD = buildTimeSeriesPath(samples, windowMs, now, CHART_WIDTH, CHART_HEIGHT, 0, max, maxGapMs)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  function handleMouseMove(e: MouseEvent<HTMLDivElement>): void {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || samples.length === 0) return
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const targetTime = now - windowMs + fraction * windowMs
    const nearest = samples.reduce((closest, s) =>
      Math.abs(s.time - targetTime) < Math.abs(closest.time - targetTime) ? s : closest
    )
    setHover({ xPercent: fraction * 100, time: nearest.time, value: nearest.value })
  }

  return (
    <div className="stats-chart">
      <div className="stats-chart-label">
        <span>{label}</span>
        <strong>{current !== undefined ? `${Math.round(current)}${unit}` : '-'}</strong>
      </div>
      <div className="stats-chart-svg-wrap" ref={wrapRef} onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" className="stats-chart-svg">
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {hover && (
          <>
            <div className="stats-chart-hover-line" style={{ left: `${hover.xPercent}%` }} />
            <div
              className="stats-chart-tooltip"
              style={{ left: `${hover.xPercent}%`, transform: tooltipTransform(hover.xPercent) }}
            >
              {new Date(hover.time).toLocaleTimeString()} · {Math.round(hover.value)}
              {unit}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface ServerStatsChartProps {
  history: StatSample[]
  windowMs: number
  now: number
}

/**
 * Three compact sparklines (CPU%, RAM, Players) stacked full-width - deliberately hand-rolled
 * SVG rather than a chart library, kept to a fixed modest height per row rather than a
 * full-page graph. `history` is already exactly the data to show (the main process has
 * already filtered to the selected time scale and downsampled it - see
 * src/main/lib/statsHistory.ts), so this component just renders it, it doesn't do any
 * windowing of its own. Hovering a row shows the time and value of the nearest sample under
 * the cursor. Only ever mounted while the Analytics tab itself is active (see
 * ServerDetail/index.tsx, which unmounts inactive tabs entirely).
 */
export default function ServerStatsChart({ history, windowMs, now }: ServerStatsChartProps): JSX.Element {
  const latest = history[history.length - 1]

  const cpuSamples = history.map((h) => ({ time: h.time, value: h.cpu }))
  const memorySamples = history.map((h) => ({ time: h.time, value: h.memoryMB }))
  const playerSamples = history.map((h) => ({ time: h.time, value: h.players }))
  // Scaled to the highest value actually seen rather than always to 100, so a server that
  // never spikes past e.g. 40% still uses the chart's full height instead of hugging the
  // bottom - a small floor keeps a near-idle server's jitter from being blown up to fill the
  // whole row. Not capped at 100: CPU usage is per-process across all cores, so a
  // multi-threaded server can legitimately read well above 100%.
  const cpuMax = Math.max(10, ...cpuSamples.map((s) => s.value))
  const memoryMax = Math.max(100, ...memorySamples.map((s) => s.value))
  // Scaled to the highest player count actually seen (never the server's configured max
  // slot count) - against a 70-slot cap, 0 vs 1 connected player is a 1/70th blip that reads
  // as a flat line either way. A floor of 1 keeps an all-zero window from dividing by zero.
  const playersMax = Math.max(1, ...playerSamples.map((s) => s.value))
  // History arrives pre-bucketed at a resolution that depends on the selected scale/window
  // (see computeBucketWidth in statsHistory.ts) - a fixed 60s gap threshold would constantly
  // (mis)fire at coarser resolutions (e.g. "All" over weeks, where consecutive real points can
  // legitimately be many minutes apart). Scale the threshold to the actual point density
  // instead, with the original 60s default as a floor for dense, short-window data.
  const maxGapMs = Math.max(MAX_CONTINUOUS_GAP_MS, (windowMs / Math.max(history.length, 1)) * 3)

  return (
    <div className="stats-charts-grid">
      <Sparkline
        label="CPU"
        unit="%"
        current={latest?.cpu}
        samples={cpuSamples}
        windowMs={windowMs}
        now={now}
        color="var(--accent)"
        max={cpuMax}
        maxGapMs={maxGapMs}
      />
      <Sparkline
        label="RAM"
        unit=" MB"
        current={latest?.memoryMB}
        samples={memorySamples}
        windowMs={windowMs}
        now={now}
        color="var(--ok)"
        max={memoryMax}
        maxGapMs={maxGapMs}
      />
      <Sparkline
        label="Players"
        unit=""
        current={latest?.players}
        samples={playerSamples}
        windowMs={windowMs}
        now={now}
        color="var(--warn)"
        max={playersMax}
        maxGapMs={maxGapMs}
      />
    </div>
  )
}
