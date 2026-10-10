/**
 * Thin wrappers around the public, no-API-key APIs each Minecraft server flavor's files are
 * published through - same "return the source's own shape, let the caller normalize" split as
 * modrinthClient.ts/curseforgeClient.ts. Picked for being the official or de-facto-standard
 * distribution channel for each loader:
 *  - vanilla: Mojang's own version manifest (https://minecraft.wiki/w/Version_manifest.json)
 *  - paper: PaperMC's own public API (https://docs.papermc.io/misc/download-api/)
 *  - fabric: FabricMC's own meta API (https://fabricmc.net/wiki/documentation:fabric_meta)
 *  - forge: Forge's own Maven (no JSON API - maven-metadata.xml is the only machine-readable
 *    version listing Forge publishes)
 *  - spigot: no download API at all - Spigot's own license terms require building it
 *    yourself from Mojang's mappings via BuildTools.jar (https://www.spigotmc.org/wiki/buildtools/),
 *    so installMinecraftServerFiles (minecraftInstall.ts) runs that instead of downloading a
 *    prebuilt jar.
 *
 * None of these endpoints could be reached from the sandbox this was written in (outbound
 * network access to piston-meta.mojang.com/api.papermc.io/meta.fabricmc.net/
 * maven.minecraftforge.net is all blocked by this environment's own proxy policy) - every
 * shape below follows each project's own published, versioned public documentation, the same
 * "confirmed against docs, not a live response" caveat already true of this codebase's
 * CurseForge fingerprint algorithm (see curseforgeFingerprint.ts). Please confirm an install
 * of each type actually works end to end on a machine with real internet access.
 */

const USER_AGENT = 'RaptorSauvage/test-manager-ark (Bober Server Manager; github.com/RaptorSauvage/test-manager-ark)'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) {
    throw new Error(`Request to ${url} failed (HTTP ${response.status})`)
  }
  return response.json() as Promise<T>
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) {
    throw new Error(`Request to ${url} failed (HTTP ${response.status})`)
  }
  return response.text()
}

// ---- Vanilla (Mojang) -------------------------------------------------------------------

interface MojangVersionManifestEntry {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  url: string
}

interface MojangVersionManifest {
  latest: { release: string; snapshot: string }
  versions: MojangVersionManifestEntry[]
}

export interface MojangVersionDownload {
  url: string
  sha1: string
  size: number
}

interface MojangVersionDetail {
  downloads: { server?: MojangVersionDownload }
}

const MOJANG_VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

/** Release versions only (no snapshots/betas/alphas) - newest first, same order the manifest
 *  itself already lists them in. */
export async function listVanillaVersions(): Promise<MojangVersionManifestEntry[]> {
  const manifest = await fetchJson<MojangVersionManifest>(MOJANG_VERSION_MANIFEST_URL)
  return manifest.versions.filter((v) => v.type === 'release')
}

/** Not every version has a server download at all (very old versions pre-date a standalone
 *  server jar) - returns undefined rather than throwing, so the caller can give a clear
 *  "this version has no server download" error instead of a confusing one. */
export async function getVanillaServerDownload(versionManifestUrl: string): Promise<MojangVersionDownload | undefined> {
  const detail = await fetchJson<MojangVersionDetail>(versionManifestUrl)
  return detail.downloads.server
}

// ---- Paper (PaperMC) ---------------------------------------------------------------------

interface PaperProjectVersions {
  versions: string[]
}

interface PaperVersionBuilds {
  builds: number[]
}

interface PaperBuildInfo {
  downloads: { application: { name: string; checksums: { sha256: string } } }
}

const PAPER_API_BASE = 'https://api.papermc.io/v2/projects/paper'

/** Newest first - PaperMC's own `versions` array is oldest-first. */
export async function listPaperVersions(): Promise<string[]> {
  const data = await fetchJson<PaperProjectVersions>(PAPER_API_BASE)
  return [...data.versions].reverse()
}

/** The highest (most recent) build number for a Paper version - Paper doesn't mark one build
 *  "stable" over another in this API, so "latest" is the standard choice (same one the
 *  PaperMC downloads page itself defaults to). */
export async function getLatestPaperBuild(version: string): Promise<{ build: number; fileName: string; sha256: string }> {
  const builds = await fetchJson<PaperVersionBuilds>(`${PAPER_API_BASE}/versions/${encodeURIComponent(version)}`)
  const build = builds.builds[builds.builds.length - 1]
  if (build === undefined) {
    throw new Error(`No Paper builds found for Minecraft ${version}.`)
  }
  const info = await fetchJson<PaperBuildInfo>(`${PAPER_API_BASE}/versions/${encodeURIComponent(version)}/builds/${build}`)
  return { build, fileName: info.downloads.application.name, sha256: info.downloads.application.checksums.sha256 }
}

export function paperDownloadUrl(version: string, build: number, fileName: string): string {
  return `${PAPER_API_BASE}/versions/${encodeURIComponent(version)}/builds/${build}/downloads/${encodeURIComponent(fileName)}`
}

// ---- Fabric (FabricMC) --------------------------------------------------------------------

interface FabricGameVersion {
  version: string
  stable: boolean
}

interface FabricLoaderVersion {
  version: string
  stable: boolean
}

interface FabricInstallerVersion {
  version: string
  stable: boolean
}

const FABRIC_META_BASE = 'https://meta.fabricmc.net/v2/versions'

/** Newest-first, stable Minecraft versions only - Fabric's own meta already orders them this
 *  way. */
export async function listFabricGameVersions(): Promise<string[]> {
  const versions = await fetchJson<FabricGameVersion[]>(`${FABRIC_META_BASE}/game`)
  return versions.filter((v) => v.stable).map((v) => v.version)
}

/** The newest stable Fabric loader version - Fabric's own meta lists the loader for a given
 *  Minecraft version at a separate endpoint, but the loader itself isn't Minecraft-version-
 *  specific (it's resolved against the game jar at launch), so the plain `/loader` listing
 *  (newest first) is enough; the mcVersion path parameter below exists only to fail clearly
 *  for a Minecraft version Fabric has no loader builds recorded for at all. */
export async function getLatestFabricLoaderVersion(mcVersion: string): Promise<string> {
  const loaders = await fetchJson<Array<{ loader: FabricLoaderVersion }>>(`${FABRIC_META_BASE}/loader/${encodeURIComponent(mcVersion)}`)
  const stable = loaders.find((l) => l.loader.stable) ?? loaders[0]
  if (!stable) {
    throw new Error(`Fabric has no loader builds for Minecraft ${mcVersion}.`)
  }
  return stable.loader.version
}

export async function getLatestFabricInstallerVersion(): Promise<string> {
  const installers = await fetchJson<FabricInstallerVersion[]>(`${FABRIC_META_BASE}/installer`)
  const stable = installers.find((i) => i.stable) ?? installers[0]
  if (!stable) {
    throw new Error('Fabric has no installer builds available.')
  }
  return stable.version
}

/** Fabric's meta server can build a ready-to-run server jar on the fly from these three
 *  versions - no separate installer step needed, unlike Forge. */
export function fabricServerJarUrl(mcVersion: string, loaderVersion: string, installerVersion: string): string {
  return `${FABRIC_META_BASE}/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/${encodeURIComponent(installerVersion)}/server/jar`
}

// ---- Forge (Minecraft Forge) ---------------------------------------------------------------

const FORGE_MAVEN_METADATA_URL = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'

/** Forge has no JSON API - maven-metadata.xml lists every published `<mcVersion>-<forgeVersion>`
 *  combination as a flat `<version>` list, oldest first. Parsed with a plain regex rather than
 *  an XML library: the file is simple, uniform, machine-generated Maven metadata (no
 *  attributes, no nesting beyond one level), not arbitrary/untrusted XML worth a real parser
 *  for. */
export async function listForgeVersionsForMinecraft(mcVersion: string): Promise<string[]> {
  const xml = await fetchText(FORGE_MAVEN_METADATA_URL)
  const prefix = `${mcVersion}-`
  const matches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  // Newest-published-first - maven-metadata.xml lists them oldest-first.
  return matches.filter((v) => v.startsWith(prefix)).reverse()
}

export function forgeInstallerUrl(mcVersion: string, forgeVersion: string): string {
  const full = `${mcVersion}-${forgeVersion}`
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
}

// ---- Spigot (BuildTools) -------------------------------------------------------------------

/** The one thing Spigot actually ships as a fixed download - everything else (the server jar
 *  itself) is compiled locally by this, against Mojang's own mappings, per Spigot's license
 *  terms. See minecraftInstall.ts's installSpigotServer for the actual build step. */
export const SPIGOT_BUILDTOOLS_URL = 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar'
