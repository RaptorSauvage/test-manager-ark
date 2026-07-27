// Pure day/time scheduling math shared between the main process (building the cron
// expression that actually drives node-cron) and the renderer (the live countdown
// display) - kept in one place so the two can never quietly disagree.

/** Parses a 24h "HH:MM" string into hour/minute, or null if malformed. */
export function parseScheduleTime(time: string): { hour: number; minute: number } | null {
  const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

/** Builds a 5-field cron expression firing at `time` on the given days (0=Sunday..6=Saturday). */
export function buildDayOfWeekCron(time: string, days: number[]): string | null {
  const parsed = parseScheduleTime(time)
  if (!parsed || days.length === 0) return null
  const sortedDays = [...new Set(days)].sort((a, b) => a - b)
  return `${parsed.minute} ${parsed.hour} * * ${sortedDays.join(',')}`
}

/** The next Date, strictly after `now`, that matches `time` on one of `days`. */
export function computeNextOccurrence(now: Date, time: string, days: number[]): Date | null {
  const parsed = parseScheduleTime(time)
  if (!parsed || days.length === 0) return null

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now)
    candidate.setDate(now.getDate() + offset)
    candidate.setHours(parsed.hour, parsed.minute, 0, 0)
    if (candidate <= now) continue
    if (days.includes(candidate.getDay())) return candidate
  }
  return null
}

/** Formats a millisecond duration as "DD:HH:MM:SS". */
export function formatCountdown(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalSeconds = Math.floor(clamped / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const totalHours = Math.floor(totalMinutes / 60)
  const hours = totalHours % 24
  const days = Math.floor(totalHours / 24)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}
