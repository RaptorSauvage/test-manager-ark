import type { MinecraftServerType } from '@shared/minecraft'

/**
 * Thin wrapper around the CurseForge Core API (https://docs.curseforge.com/) - unlike
 * Modrinth, every endpoint requires an API key (the `x-api-key` header below), free for
 * non-commercial use at https://console.curseforge.com/ (see the README for exact steps).
 * Returns CurseForge's own raw shapes rather than normalizing here - minecraftMods.ts is the
 * one place that converts into this app's own MinecraftModSearchResult/InstalledMinecraftMod
 * shapes, same split as modrinthClient.ts.
 */

const API_BASE = 'https://api.curseforge.com/v1'

/** CurseForge's own numeric id for the Minecraft game - fixed, not something that varies per
 *  request. */
const MINECRAFT_GAME_ID = 432

/** CurseForge's own numeric "class" ids for the two kinds of thing this app installs - there's
 *  no single "mod" type covering both the way Modrinth's v2 API flattens it; Forge/Fabric
 *  content is class 6 ("Mods"), Paper/Spigot content is class 4471 ("Bukkit Plugins"). */
const MODS_CLASS_ID = 6
const BUKKIT_PLUGINS_CLASS_ID = 4471

/** CurseForge's own numeric "mod loader type" enum, used to filter /mods/search and
 *  /mods/{id}/files by loader. There's no meaningful value for Paper/Spigot (plugins aren't
 *  filtered by loader on CurseForge) - omit the param entirely for those. */
function modLoaderTypeFor(serverType: MinecraftServerType): number | undefined {
  switch (serverType) {
    case 'forge':
      return 1
    case 'fabric':
      return 4
    default:
      return undefined
  }
}

function classIdFor(serverType: MinecraftServerType): number {
  return serverType === 'paper' || serverType === 'spigot' ? BUKKIT_PLUGINS_CLASS_ID : MODS_CLASS_ID
}

export interface CurseForgeModLogo {
  thumbnailUrl: string | null
}

export interface CurseForgeMod {
  id: number
  slug: string
  name: string
  summary: string
  downloadCount: number
  logo: CurseForgeModLogo | null
  /** False when the author has opted the mod out of third-party distribution - its files have
   *  no downloadUrl, so this app can't install it automatically (see installCurseForgeMod's
   *  own check). Still shown in search results; just not installable from here. */
  allowModDistribution: boolean | null
}

export interface CurseForgeFileHash {
  value: string
  /** 1 = Sha1, 2 = Md5 (CurseForge's own enum). */
  algo: number
}

export type CurseForgeFileRelationType = 1 | 2 | 3 | 4 | 5 | 6

export interface CurseForgeFileDependency {
  modId: number
  /** 1 = EmbeddedLibrary, 2 = OptionalDependency, 3 = RequiredDependency, 4 = Tool,
   *  5 = Incompatible, 6 = Include. */
  relationType: CurseForgeFileRelationType
}

export interface CurseForgeFile {
  id: number
  modId: number
  fileName: string
  displayName: string
  downloadUrl: string | null
  gameVersions: string[]
  fileDate: string
  hashes: CurseForgeFileHash[]
  dependencies: CurseForgeFileDependency[]
}

interface CurseForgeSearchResponse {
  data: CurseForgeMod[]
}

interface CurseForgeModResponse {
  data: CurseForgeMod
}

interface CurseForgeFilesResponse {
  data: CurseForgeFile[]
}

interface CurseForgeFileResponse {
  data: CurseForgeFile
}

interface CurseForgeFingerprintMatch {
  id: number
  file: CurseForgeFile
}

interface CurseForgeFingerprintResponse {
  data: {
    exactMatches: CurseForgeFingerprintMatch[]
  }
}

async function curseforgeFetch<T>(apiKey: string, path: string, searchParams: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(searchParams)) url.searchParams.set(key, value)
  const response = await fetch(url, { headers: { 'x-api-key': apiKey, Accept: 'application/json' } })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('CurseForge rejected this API key - check it in Settings.')
    }
    throw new Error(`CurseForge request failed (HTTP ${response.status}): ${path}`)
  }
  return (await response.json()) as T
}

export async function searchCurseForgeMods(
  apiKey: string,
  query: string,
  serverType: MinecraftServerType,
  minecraftVersion: string,
  limit = 20
): Promise<CurseForgeMod[]> {
  const params: Record<string, string> = {
    gameId: String(MINECRAFT_GAME_ID),
    classId: String(classIdFor(serverType)),
    searchFilter: query,
    pageSize: String(limit),
    sortField: '2', // Popularity
    sortOrder: 'desc'
  }
  if (minecraftVersion.trim()) params.gameVersion = minecraftVersion.trim()
  const loaderType = modLoaderTypeFor(serverType)
  if (loaderType !== undefined) params.modLoaderType = String(loaderType)
  const response = await curseforgeFetch<CurseForgeSearchResponse>(apiKey, '/mods/search', params)
  return response.data
}

export async function getCurseForgeMod(apiKey: string, modId: number): Promise<CurseForgeMod> {
  const response = await curseforgeFetch<CurseForgeModResponse>(apiKey, `/mods/${modId}`)
  return response.data
}

/** Compatible files for one mod, newest first (CurseForge's /files endpoint doesn't guarantee
 *  an order, so this sorts by fileDate itself) - `[0]` is "the latest compatible file"
 *  wherever this app needs just that, same convention as modrinthClient's
 *  getModrinthProjectVersions. */
export async function getCurseForgeModFiles(
  apiKey: string,
  modId: number,
  serverType: MinecraftServerType,
  minecraftVersion: string
): Promise<CurseForgeFile[]> {
  const params: Record<string, string> = {}
  if (minecraftVersion.trim()) params.gameVersion = minecraftVersion.trim()
  const loaderType = modLoaderTypeFor(serverType)
  if (loaderType !== undefined) params.modLoaderType = String(loaderType)
  const response = await curseforgeFetch<CurseForgeFilesResponse>(apiKey, `/mods/${modId}/files`, params)
  return [...response.data].sort((a, b) => new Date(b.fileDate).getTime() - new Date(a.fileDate).getTime())
}

export async function getCurseForgeFile(apiKey: string, modId: number, fileId: number): Promise<CurseForgeFile> {
  const response = await curseforgeFetch<CurseForgeFileResponse>(apiKey, `/mods/${modId}/files/${fileId}`)
  return response.data
}

/**
 * Identifies files by CurseForge's own "fingerprint" (a murmur2 hash of the file with
 * whitespace bytes stripped - not implemented here, since nothing in this app computes one
 * yet; see shared/minecraftMods.ts's MinecraftModScanResult doc comment). Kept here now so
 * the endpoint exists and is tested the moment fingerprinting itself is added, without
 * another round of client-module work.
 */
export async function getCurseForgeFingerprintMatches(apiKey: string, fingerprints: number[]): Promise<CurseForgeFingerprintMatch[]> {
  if (fingerprints.length === 0) return []
  const response = await fetch(`${API_BASE}/fingerprints`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ fingerprints })
  })
  if (!response.ok) {
    throw new Error(`CurseForge request failed (HTTP ${response.status}): /fingerprints`)
  }
  const body = (await response.json()) as CurseForgeFingerprintResponse
  return body.data.exactMatches
}
