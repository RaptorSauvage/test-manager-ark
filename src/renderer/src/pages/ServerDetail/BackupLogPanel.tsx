import { useEffect, useRef, useState } from 'react'
import type { BackupLogEntry } from '@shared/types'

interface BackupLogPanelProps {
  profileId: string
}

/** Live log of a backup's SaveGame -> settle -> zip sequence - manual or scheduled - so a
 *  backup nobody's watching happen in real time (especially an automatic one) can still
 *  be monitored/debugged after the fact instead of being a black box. */
export default function BackupLogPanel({ profileId }: BackupLogPanelProps): JSX.Element {
  const [entries, setEntries] = useState<BackupLogEntry[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    window.api.backup.getLog(profileId).then((log) => {
      if (!cancelled) setEntries(log)
    })
    return () => {
      cancelled = true
    }
  }, [profileId])

  useEffect(() => {
    return window.api.backup.onLogChanged((changedProfileId, entry) => {
      if (changedProfileId !== profileId) return
      setEntries((prev) => [...prev, entry])
    })
  }, [profileId])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  return (
    <section className="backup-log-panel">
      <h3>Backup Process Log</h3>
      <p className="empty-state">
        Traces each backup&apos;s SaveGame → 30s settle → zip sequence - manual or scheduled - for monitoring and
        debugging. Cleared when the Manager restarts.
      </p>
      <div className="backup-log-list" ref={listRef}>
        {entries.length === 0 && <p className="empty-state">No backup activity yet.</p>}
        {entries.map((entry, i) => (
          <p key={i} className={entry.level === 'error' ? 'backup-log-line error-message' : 'backup-log-line'}>
            <span className="backup-log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span> {entry.message}
          </p>
        ))}
      </div>
    </section>
  )
}
