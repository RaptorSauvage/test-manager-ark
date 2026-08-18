import { buildSparklinePoints, type StatSample } from '../../lib/sparkline'

const CHART_WIDTH = 200
const CHART_HEIGHT = 40

interface SparklineProps {
  label: string
  unit: string
  values: number[]
  color: string
  max: number
}

function Sparkline({ label, unit, values, color, max }: SparklineProps): JSX.Element {
  const points = buildSparklinePoints(values, CHART_WIDTH, CHART_HEIGHT, 0, max)
  const current = values[values.length - 1]

  return (
    <div className="stats-chart">
      <div className="stats-chart-header">
        <span>{label}</span>
        <strong>{current !== undefined ? `${Math.round(current)}${unit}` : '-'}</strong>
      </div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" className="stats-chart-svg">
        {points && (
          <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
    </div>
  )
}

interface ServerStatsChartProps {
  history: StatSample[]
  maxPlayers: number
}

/**
 * Three compact sparklines (CPU%, RAM, Players) over whatever window of samples the
 * caller hands in - deliberately small (a fixed low-height SVG each, not a full-page
 * chart library) since this is meant as an at-a-glance trend, not a detailed dashboard.
 * Only ever mounted while the Analytics tab itself is active (see ServerDetail/index.tsx,
 * which unmounts inactive tabs entirely), so sampling and redrawing both stop the moment
 * you navigate away instead of running in the background.
 */
export default function ServerStatsChart({ history, maxPlayers }: ServerStatsChartProps): JSX.Element {
  const cpuValues = history.map((h) => h.cpu)
  const memoryValues = history.map((h) => h.memoryMB)
  const playerValues = history.map((h) => h.players)
  const memoryMax = Math.max(100, ...memoryValues)

  return (
    <div className="stats-charts-grid">
      <Sparkline label="CPU" unit="%" values={cpuValues} color="var(--accent)" max={100} />
      <Sparkline label="RAM" unit=" MB" values={memoryValues} color="var(--ok)" max={memoryMax} />
      <Sparkline label="Players" unit="" values={playerValues} color="var(--warn)" max={Math.max(maxPlayers, 1)} />
    </div>
  )
}
