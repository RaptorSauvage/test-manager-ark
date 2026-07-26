import { useEffect, useState } from 'react'
import type { ServerStatus } from '@shared/types'

export function useServerStatuses(profileIds: string[]): Record<string, ServerStatus> {
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({})
  const key = profileIds.join(',')

  useEffect(() => {
    let cancelled = false
    Promise.all(profileIds.map((id) => window.api.server.status(id))).then((results) => {
      if (cancelled) return
      setStatuses((prev) => {
        const next = { ...prev }
        for (const status of results) next[status.profileId] = status
        return next
      })
    })
    return () => {
      cancelled = true
    }
    // profileIds is derived fresh each render; `key` is the stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    return window.api.server.onStatusChanged((status) => {
      setStatuses((prev) => ({ ...prev, [status.profileId]: status }))
    })
  }, [])

  return statuses
}
