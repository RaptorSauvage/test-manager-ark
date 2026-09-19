import { useEffect, useRef, useState } from 'react'
import type { ServerProfile } from '@shared/types'

interface UpdateLogTabProps {
  profile: ServerProfile
}

/** Live view of this server's last SteamCMD update run (install/update, manual or
 *  scheduled) - previously a toggleable panel on the Dashboard card that only refreshed
 *  while left open there; as a dedicated tab it now always subscribes to live updates for
 *  as long as it's the active tab, the same way BackupLogPanel does for backups. */
export default function UpdateLogTab({ profile }: UpdateLogTabProps): JSX.Element {
  const [logContent, setLogContent] = useState('')
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let cancelled = false
    window.api.steamcmd.getUpdateLog(profile.id).then((log) => {
      if (!cancelled) setLogContent(log ?? 'No update log yet - run Update at least once.')
    })
    return () => {
      cancelled = true
    }
  }, [profile.id])

  useEffect(() => {
    return window.api.steamcmd.onUpdateLogChanged((changedProfileId) => {
      if (changedProfileId !== profile.id) return
      void window.api.steamcmd
        .getUpdateLog(profile.id)
        .then((log) => setLogContent(log ?? 'No update log yet - run Update at least once.'))
    })
  }, [profile.id])

  useEffect(() => {
    const el = preRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logContent])

  return (
    <section className="update-log-tab">
      <h3>Update Log</h3>
      <p className="empty-state">
        Output of this server&apos;s last SteamCMD install/update run - manual or scheduled. Refreshes live while
        this tab is open.
      </p>
      <pre className="log-output" ref={preRef}>
        {logContent}
      </pre>
    </section>
  )
}
