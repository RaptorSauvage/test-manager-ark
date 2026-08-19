import { useEffect, useState } from 'react'
import type { LatestBuildIdCache } from '@shared/types'

interface UpdateCheckPanelProps {
  /** Profiles to compare against the latest known build id - every profile for the
   *  dashboard-wide panel, or just the one for a server's Analytics tab. */
  profileIds: string[]
  /** When true, renders just the status line - no section wrapper, header, or explanatory
   *  paragraph - for embedding inline within another section's own group instead of as its
   *  own standalone panel. */
  compact?: boolean
}

/** Same visual embed as OfficialServerStatusPanel (official-status-panel/-header/-line
 *  classes), for the "New update" check - polls the cached latest SteamCMD build id and
 *  compares it against each given profile's own installed build id. */
export default function UpdateCheckPanel({ profileIds, compact = false }: UpdateCheckPanelProps): JSX.Element {
  const [latest, setLatest] = useState<LatestBuildIdCache | null>(null)
  const [installedBuildIds, setInstalledBuildIds] = useState<Array<string | null>>([])
  const profileIdsKey = profileIds.join(',')

  useEffect(() => {
    let cancelled = false
    function refresh(): void {
      window.api.steamcmd.getLatestBuildId().then((cache) => {
        if (!cancelled) setLatest(cache)
      })
    }
    refresh()
    const interval = setInterval(refresh, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all(profileIds.map((id) => window.api.server.getInstalledBuildId(id))).then((ids) => {
      if (!cancelled) setInstalledBuildIds(ids)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIdsKey])

  const latestBuildId = latest?.buildId ?? null
  const knownInstalled = installedBuildIds.filter((id): id is string => id !== null)
  const updateAvailable = latestBuildId !== null && knownInstalled.some((id) => id !== latestBuildId)

  const statusLine = latest?.error ? (
    <p className="error-message">{latest.error}</p>
  ) : (
    <p className="official-status-line">
      {latestBuildId === null || knownInstalled.length === 0 ? (
        <span className="official-status-value">Checking...</span>
      ) : updateAvailable ? (
        <span className="official-status-value status-warn">A server update is available.</span>
      ) : (
        <span className="official-status-value status-ok">No new update available.</span>
      )}
    </p>
  )

  if (compact) return statusLine

  return (
    <section className="official-status-panel">
      <div className="official-status-header">
        <h3>New update</h3>
      </div>
      <p className="empty-state">
        Checked against SteamCMD&apos;s public branch build id for the ARK: Survival Ascended Dedicated Server,
        every 30 minutes.
      </p>
      {statusLine}
    </section>
  )
}
