import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { computeNextOccurrence, formatCountdown } from '@shared/scheduleTime'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface ScheduleDaysPickerProps {
  label: string
  countdownLabel: string
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  time: string
  onTimeChange: (value: string) => void
  days: number[]
  onDaysChange: (days: number[]) => void
  children?: ReactNode
}

/** Time + day-of-week picker with a live "next occurrence" countdown, shared between the
 *  scheduled restart and scheduled dino wipe sections. */
export default function ScheduleDaysPicker({
  label,
  countdownLabel,
  enabled,
  onEnabledChange,
  time,
  onTimeChange,
  days,
  onDaysChange,
  children
}: ScheduleDaysPickerProps): JSX.Element {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  function toggleDay(day: number): void {
    onDaysChange(days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b))
  }

  const next = enabled ? computeNextOccurrence(now, time, days) : null

  return (
    <div className="schedule-picker">
      <div className="schedule-picker-row">
        <label className="checkbox">
          <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
          {label}
        </label>
        <input type="time" value={time} onChange={(e) => onTimeChange(e.target.value)} disabled={!enabled} />
        {DAY_LABELS.map((dayLabel, index) => (
          <label key={dayLabel} className="checkbox schedule-day">
            <input
              type="checkbox"
              checked={days.includes(index)}
              onChange={() => toggleDay(index)}
              disabled={!enabled}
            />
            {dayLabel}
          </label>
        ))}
      </div>
      {children}
      <p className="schedule-countdown">
        {countdownLabel} {next ? formatCountdown(next.getTime() - now.getTime()) : '--:--:--:--'}
      </p>
    </div>
  )
}
