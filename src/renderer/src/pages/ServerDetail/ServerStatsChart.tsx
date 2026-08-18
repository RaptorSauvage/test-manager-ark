import { buildTimeSeriesPoints, selectHistoryWindow, type StatSample } from '../../lib/sparkline'

const CHART_WIDTH = 1000
const CHART_HEIGHT = 60

interface SparklineProps {
  label: string
  unit: string
  current: number | undefined
  samples: Array<{ time: number; value: number }>
  windowMs: number
  now: number
  color: string
  max: number
}

function Sparkline({ label, unit, current, samples, windowMs, now, color, max }: SparklineProps): JSX.Element {
  const points = buildTimeSeriesPoints(samples, windowMs, now, CHART_WIDTH, CHART_HEIGHT, 0, max)

  return (
    <div className="stats-chart">
      <div className="stats-chart-header">
        <span>{label}</span>
        <strong>{current !== undefined ? `${Math.round(current)}${unit}` : '-'}</strong>
      </div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" className="stats-chart-svg">
        {points && (
          <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
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
 * Three compact sparklines (CPU%, RAM, Players) stacked full-width, each showing samples
 * that fall within the last `windowMs` (the selected time scale) out of the full history the
 * caller collected - deliberately hand-rolled SVG rather than a chart library, kept to a fixed
 * modest height per row rather than a full-page graph. Only ever mounted while the Analytics
 * tab itself is active (see ServerDetail/index.tsx, which unmounts inactive tabs entirely), so
 * sampling and redrawing both stop the moment you navigate away instead of running in the
 * background.
 */
export default function ServerStatsChart({ history, maxPlayers, windowMs, now }: ServerStatsChartProps): JSX.Element {
  const windowed = selectHistoryWindow(history, windowMs, now)
  const latest = history[history.length - 1]

  const cpuSamples = windowed.map((h) => ({ time: h.time, value: h.cpu }))
  const memorySamples = windowed.map((h) => ({ time: h.time, value: h.memoryMB }))
  const playerSamples = windowed.map((h) => ({ time: h.time, value: h.players }))
  const memoryMax = Math.max(100, ...memorySamples.map((s) => s.value))

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
        max={100}
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
      />
    </div>
  )
}
