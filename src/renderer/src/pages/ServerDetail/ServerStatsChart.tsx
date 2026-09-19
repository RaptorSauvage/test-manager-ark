import { useRef, useState, type MouseEvent } from 'react'
import { buildTimeSeriesPath, MAX_CONTINUOUS_GAP_MS, type StatSample } from '../../lib/sparkline'

const CHART_WIDTH = 1000
const CHART_HEIGHT = 60

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
            <div className="stats-chart-tooltip" style={{ left: `${hover.xPercent}%` }}>
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
  maxPlayers: number
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
export default function ServerStatsChart({ history, maxPlayers, windowMs, now }: ServerStatsChartProps): JSX.Element {
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
        max={Math.max(maxPlayers, 1)}
        maxGapMs={maxGapMs}
      />
    </div>
  )
}
