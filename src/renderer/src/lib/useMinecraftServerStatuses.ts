import { useEffect, useState } from 'react'
import type { MinecraftServerStatus } from '@shared/minecraft'

export function useMinecraftServerStatuses(profileIds: string[]): Record<string, MinecraftServerStatus> {
  const [statuses, setStatuses] = useState<Record<string, MinecraftServerStatus>>({})
  const key = profileIds.join(',')

  useEffect(() => {
    let cancelled = false
    Promise.all(profileIds.map((id) => window.api.minecraft.server.getStatus(id))).then((results) => {
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
    return window.api.minecraft.server.onStatusChanged((status) => {
      setStatuses((prev) => ({ ...prev, [status.profileId]: status }))
    })
  }, [])

  return statuses
}
