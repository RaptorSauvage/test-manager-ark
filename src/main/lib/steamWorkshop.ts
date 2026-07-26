interface PublishedFileDetail {
  publishedfileid: string
  result: number
  title?: string
}

interface GetPublishedFileDetailsResponse {
  response?: {
    publishedfiledetails?: PublishedFileDetail[]
  }
}

const STEAM_API_URL = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/'
const STEAM_RESULT_OK = 1

/**
 * Resolves Steam Workshop mod IDs to their titles via Steam's public Web API
 * (no API key required for this endpoint). Missing/unknown IDs are simply
 * absent from the returned map - callers should fall back to showing the ID.
 */
export async function fetchModNames(
  ids: string[],
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, string>> {
  if (ids.length === 0) return {}

  const body = new URLSearchParams()
  body.set('itemcount', String(ids.length))
  ids.forEach((id, index) => body.set(`publishedfileids[${index}]`, id))

  const response = await fetchImpl(STEAM_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })

  if (!response.ok) {
    throw new Error(`Steam Workshop lookup failed with status ${response.status}`)
  }

  const data = (await response.json()) as GetPublishedFileDetailsResponse
  const names: Record<string, string> = {}
  for (const detail of data.response?.publishedfiledetails ?? []) {
    if (detail.result === STEAM_RESULT_OK && detail.title) {
      names[detail.publishedfileid] = detail.title
    }
  }
  return names
}
