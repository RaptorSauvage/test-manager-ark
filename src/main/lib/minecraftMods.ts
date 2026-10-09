import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { shell } from 'electron'
import type { MinecraftProfile, MinecraftServerType } from '@shared/minecraft'
import { supportsMinecraftMods } from '@shared/minecraftMods'
import type {
  MinecraftModSource,
  MinecraftModSearchResult,
  MinecraftModInstallResult,
  MinecraftModDependency,
  InstalledMinecraftMod,
  MinecraftModUpdateCheckResult,
  MinecraftModScanResult
} from '@shared/minecraftMods'
import {
  searchModrinthProjects,
  getModrinthProjectVersions,
  getModrinthVersion,
  getModrinthProject,
  getModrinthProjects,
  getModrinthVersionsFromHashes,
  type ModrinthVersion,
  type ModrinthVersionFile
} from './modrinthClient'
import {
  searchCurseForgeMods,
  getCurseForgeMod,
  getCurseForgeMods,
  getCurseForgeModFiles,
  getCurseForgeFingerprintMatches,
  type CurseForgeFile,
  type CurseForgeFileDependency
} from './curseforgeClient'
import { computeCurseForgeFingerprint } from './curseforgeFingerprint'
import { saveMinecraftProfile, getSettings } from '../store'
import { logManagerEvent, newTaskId } from './managerLog'
import { delay } from './delay'

/** Forge/Fabric read mods from `mods/`; Paper/Spigot read plugins from `plugins/`. */
export function modTargetDir(profile: MinecraftProfile): string {
  const sub = profile.serverType === 'forge' || profile.serverType === 'fabric' ? 'mods' : 'plugins'
  return path.join(profile.installDir, sub)
}

/** Checked by every operation, including scanning - a hash-based lookup doesn't actually
 *  need the loader, but a profile with no mod/plugin ecosystem at all has no mods/plugins
 *  folder worth scanning either. */
function requireLoaderSupportsMods(profile: MinecraftProfile): void {
  if (!supportsMinecraftMods(profile.serverType)) {
    throw new Error('This server type has no mod/plugin ecosystem - set Server type in Start Settings first.')
  }
}

/** Checked by search/install/update/checkUpdates - unlike scanning (hash identification
 *  alone), picking a *compatible* version genuinely needs to know the server's Minecraft
 *  version. */
function requireModsSupported(profile: MinecraftProfile): void {
  requireLoaderSupportsMods(profile)
  if (!profile.minecraftVersion.trim()) {
    throw new Error("Set this server's Minecraft version in Start Settings first.")
  }
}

/** Searches Modrinth, plus CurseForge too when an API key is configured (AppSettings.
 *  curseforgeApiKey - see the README for where to get one). CurseForge failing (bad key,
 *  network hiccup) doesn't fail the whole search - it's logged and dropped, leaving the
 *  Modrinth results intact, same "best effort, don't let one source wreck the other"
 *  reasoning as scanForInstalledMods' own adoption loop. */
export async function searchMinecraftMods(profile: MinecraftProfile, query: string): Promise<MinecraftModSearchResult[]> {
  requireModsSupported(profile)
  const installedIds = new Set(profile.installedMods.map((m) => m.projectId))

  const hits = await searchModrinthProjects(query, profile.serverType, profile.minecraftVersion)
  const modrinthResults: MinecraftModSearchResult[] = hits.map((hit) => ({
    source: 'modrinth' as const,
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    iconUrl: hit.icon_url ?? undefined,
    downloads: hit.downloads,
    installed: installedIds.has(hit.project_id)
  }))

  const apiKey = getSettings().curseforgeApiKey.trim()
  if (!apiKey) return modrinthResults

  let curseforgeResults: MinecraftModSearchResult[] = []
  try {
    const cfHits = await searchCurseForgeMods(apiKey, query, profile.serverType, profile.minecraftVersion)
    curseforgeResults = cfHits
      .filter((hit) => hit.allowModDistribution !== false)
      .map((hit) => ({
        source: 'curseforge' as const,
        projectId: String(hit.id),
        slug: hit.slug,
        title: hit.name,
        description: hit.summary,
        iconUrl: hit.logo?.thumbnailUrl ?? undefined,
        downloads: hit.downloadCount,
        installed: installedIds.has(String(hit.id))
      }))
  } catch (err) {
    logManagerEvent(newTaskId('mc-mod-search'), `Search mods/plugins — ${profile.name}`, `CurseForge search failed: ${(err as Error).message}`, 'error')
  }

  return mergeDuplicateSearchResults([...modrinthResults, ...curseforgeResults]).sort((a, b) => b.downloads - a.downloads)
}

/**
 * Merges search hits that are heuristically the same mod, found via more than one source,
 * into a single row - without this, a mod published on both Modrinth and CurseForge showed up
 * as two separate, identically-named rows in the Browse results. Matched by exact (case-
 * insensitive) title: unlike scanForInstalledMods, there's no shared cross-platform id or file
 * hash/fingerprint available at search time to confirm two hits are really the same mod, so
 * this trades a small false-positive risk (a coincidentally same-titled but actually different
 * mod from each source) for not showing an obvious true-positive duplicate twice - see
 * MinecraftModSearchResult.alsoAvailableOn's own doc comment. Modrinth is kept as the primary/
 * kept row when both are present (same "no API key needed" preference used everywhere else in
 * this app that picks between the two sources), with the other source(s) attached informationally.
 */
function mergeDuplicateSearchResults(results: MinecraftModSearchResult[]): MinecraftModSearchResult[] {
  const groups = new Map<string, MinecraftModSearchResult[]>()
  for (const result of results) {
    const key = result.title.trim().toLowerCase()
    const group = groups.get(key)
    if (group) group.push(result)
    else groups.set(key, [result])
  }

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]
    const primary = group.find((r) => r.source === 'modrinth') ?? group[0]
    const others = group.filter((r) => r !== primary)
    return {
      ...primary,
      installed: group.some((r) => r.installed),
      alsoAvailableOn: others.map((r) => ({ source: r.source, projectId: r.projectId }))
    }
  })
}

/** Picks the file to actually download from a version - the one marked `primary`, or the
 *  first file if none is (a version always has at least one file; Modrinth's own docs don't
 *  guarantee exactly one `primary`, so this is a defensive fallback, not an expected case). */
export function primaryFileOf(version: ModrinthVersion): ModrinthVersionFile {
  return version.files.find((f) => f.primary) ?? version.files[0]
}

/** Caps dependency-walk depth - a real safety net against a pathological/cyclic dependency
 *  graph, not expected to ever matter for a real mod (dependency chains are rarely more than
 *  2-3 deep in practice). */
const MAX_DEPENDENCY_DEPTH = 10

interface ResolvedInstall {
  version: ModrinthVersion
  installedAs: 'user' | 'dependency'
}

interface ModInstallPlan {
  toInstall: ResolvedInstall[]
  optionalSkipped: MinecraftModDependency[]
  incompatible: MinecraftModDependency[]
}

/**
 * Walks `rootVersion`'s own `dependencies`, recursively resolving every 'required' one to an
 * installable version - skipping anything already installed or already queued this run, and
 * leaving 'embedded'/'optional'/'incompatible' ones alone (see shared/minecraftMods.ts's own
 * doc comments for what each dependency_type means for install purposes: embedded is already
 * bundled in the jar, optional is never auto-installed, incompatible is only a warning when
 * the conflicting project is already installed). Returns every version that actually needs
 * installing (the requested one first, then its required dependencies in discovery order).
 *
 * `getProjectVersions`/`getVersion` are injected (rather than imported directly from
 * modrinthClient) so this - the actual interesting logic - can be unit-tested without any
 * network access.
 */
export async function resolveModInstallPlan(
  rootVersion: ModrinthVersion,
  profile: Pick<MinecraftProfile, 'serverType' | 'minecraftVersion'>,
  alreadyInstalledProjectIds: ReadonlySet<string>,
  deps: {
    getProjectVersions: (
      projectId: string,
      serverType: MinecraftServerType,
      mcVersion: string
    ) => Promise<ModrinthVersion[]>
    getVersion: (versionId: string) => Promise<ModrinthVersion>
  }
): Promise<ModInstallPlan> {
  const toInstall: ResolvedInstall[] = [{ version: rootVersion, installedAs: 'user' }]
  const seenProjectIds = new Set<string>([rootVersion.project_id, ...alreadyInstalledProjectIds])
  const optionalSkipped: MinecraftModDependency[] = []
  const incompatible: MinecraftModDependency[] = []

  let queue = [...rootVersion.dependencies]
  let depth = 0
  while (queue.length > 0 && depth < MAX_DEPENDENCY_DEPTH) {
    depth += 1
    const next: typeof queue = []
    for (const dep of queue) {
      if (dep.dependency_type === 'embedded') continue

      if (dep.dependency_type === 'incompatible') {
        if (dep.project_id && alreadyInstalledProjectIds.has(dep.project_id)) {
          incompatible.push({ projectId: dep.project_id, dependencyType: 'incompatible' })
        }
        continue
      }

      if (dep.dependency_type === 'optional') {
        if (dep.project_id && !seenProjectIds.has(dep.project_id)) {
          optionalSkipped.push({ projectId: dep.project_id, dependencyType: 'optional' })
        }
        continue
      }

      // required
      if (!dep.project_id && !dep.version_id) continue
      if (dep.project_id && seenProjectIds.has(dep.project_id)) continue

      let depVersion: ModrinthVersion | null = null
      if (dep.version_id) {
        depVersion = await deps.getVersion(dep.version_id)
      } else if (dep.project_id) {
        const versions = await deps.getProjectVersions(dep.project_id, profile.serverType, profile.minecraftVersion)
        depVersion = versions[0] ?? null
      }
      if (!depVersion || seenProjectIds.has(depVersion.project_id)) continue

      seenProjectIds.add(depVersion.project_id)
      toInstall.push({ version: depVersion, installedAs: 'dependency' })
      next.push(...depVersion.dependencies)
    }
    queue = next
  }

  return { toInstall, optionalSkipped, incompatible }
}

const DISABLED_SUFFIX = '.disabled'

function diskFileName(fileName: string, enabled: boolean): string {
  return enabled ? fileName : `${fileName}${DISABLED_SUFFIX}`
}

/** Downloads one version's primary file straight to disk, verifying it against whichever
 *  hash Modrinth published for it (sha512 preferred, sha1 as a fallback) before it's kept -
 *  a corrupted/truncated download is discarded rather than left as a jar the server might
 *  fail to load (or worse, load partially) on next start. */
async function downloadVersionFile(file: ModrinthVersionFile, targetPath: string): Promise<void> {
  const response = await fetch(file.url)
  if (!response.ok) {
    throw new Error(`Failed to download ${file.filename} (HTTP ${response.status})`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())

  const expectedHash = file.hashes.sha512 ?? file.hashes.sha1
  if (expectedHash) {
    const algorithm = file.hashes.sha512 ? 'sha512' : 'sha1'
    const actualHash = crypto.createHash(algorithm).update(buffer).digest('hex')
    if (actualHash !== expectedHash) {
      throw new Error(`Downloaded ${file.filename} failed its ${algorithm} checksum - discarding it.`)
    }
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, buffer)
}

/** Removes a previously-installed file from disk (if a prior install under the same name
 *  left one behind, enabled or not) before writing the new one - avoids leaving a stale
 *  `.disabled` copy alongside a freshly (re)installed, enabled jar. */
function removeExistingFile(targetDir: string, fileName: string): void {
  for (const name of [fileName, `${fileName}.disabled`]) {
    const filePath = path.join(targetDir, name)
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true })
  }
}

async function installResolvedVersion(
  version: ModrinthVersion,
  installedAs: 'user' | 'dependency',
  targetDir: string
): Promise<InstalledMinecraftMod> {
  const file = primaryFileOf(version)
  const project = await getModrinthProject(version.project_id)

  removeExistingFile(targetDir, file.filename)
  await downloadVersionFile(file, path.join(targetDir, diskFileName(file.filename, true)))

  return {
    source: 'modrinth',
    projectId: version.project_id,
    slug: project.slug,
    title: project.title,
    iconUrl: project.icon_url ?? undefined,
    versionId: version.id,
    versionNumber: version.version_number,
    fileName: file.filename,
    enabled: true,
    installedAs,
    installedAt: Date.now()
  }
}

/**
 * Installs the latest compatible version of `projectId` (the one this app itself considers
 * compatible: matching loader + the profile's own minecraftVersion), plus every 'required'
 * dependency it declares, recursively (see resolveModInstallPlan). No version picker in this
 * first pass - always the latest compatible release, same simplification ARK's own mod
 * system makes (no version picker there either, just an id).
 */
async function installModrinthMod(
  profile: MinecraftProfile,
  projectId: string
): Promise<{ profile: MinecraftProfile; result: MinecraftModInstallResult }> {
  requireModsSupported(profile)
  const taskId = newTaskId('mc-mod-install')
  const taskLabel = `Install mod/plugin — ${profile.name}`
  logManagerEvent(taskId, taskLabel, `Resolving ${projectId}...`)

  const versions = await getModrinthProjectVersions(projectId, profile.serverType, profile.minecraftVersion)
  const rootVersion = versions[0]
  if (!rootVersion) {
    const message = "No version of this mod/plugin is compatible with this server's loader/Minecraft version."
    logManagerEvent(taskId, taskLabel, `Failed: ${message}`, 'error')
    throw new Error(message)
  }

  const alreadyInstalled = new Set(profile.installedMods.map((m) => m.projectId))
  const plan = await resolveModInstallPlan(rootVersion, profile, alreadyInstalled, {
    getProjectVersions: getModrinthProjectVersions,
    getVersion: getModrinthVersion
  })

  const targetDir = modTargetDir(profile)
  // Reinstalling/updating an already-installed mod the user had disabled shouldn't silently
  // re-enable it - installResolvedVersion always writes a fresh download as enabled (the
  // right default for something genuinely new), so a previously-disabled one is flipped back
  // right after, on both the profile entry and the file actually on disk.
  const previousEnabledByProjectId = new Map(profile.installedMods.map((m) => [m.projectId, m.enabled]))
  const installedNow: InstalledMinecraftMod[] = []
  for (const { version, installedAs } of plan.toInstall) {
    const installed = await installResolvedVersion(version, installedAs, targetDir)
    if (previousEnabledByProjectId.get(installed.projectId) === false) {
      const fromPath = path.join(targetDir, diskFileName(installed.fileName, true))
      const toPath = path.join(targetDir, diskFileName(installed.fileName, false))
      if (fs.existsSync(fromPath)) fs.renameSync(fromPath, toPath)
      installed.enabled = false
    }
    installedNow.push(installed)
  }

  const nextInstalledMods = [
    ...profile.installedMods.filter((m) => !installedNow.some((n) => n.projectId === m.projectId)),
    ...installedNow
  ]
  const updatedProfile: MinecraftProfile = { ...profile, installedMods: nextInstalledMods }
  saveMinecraftProfile(updatedProfile)

  logManagerEvent(
    taskId,
    taskLabel,
    `Installed ${installedNow.map((m) => m.title).join(', ')}${
      plan.toInstall.length > 1 ? ` (${plan.toInstall.length - 1} dependenc${plan.toInstall.length - 1 === 1 ? 'y' : 'ies'})` : ''
    }`
  )

  return {
    profile: updatedProfile,
    result: {
      installed: installedNow,
      dependenciesInstalled: installedNow.filter((m) => m.installedAs === 'dependency'),
      optionalDependenciesSkipped: plan.optionalSkipped,
      incompatibleWithInstalled: plan.incompatible
    }
  }
}

interface CurseForgeResolvedInstall {
  modId: number
  file: CurseForgeFile
  installedAs: 'user' | 'dependency'
}

interface CurseForgeInstallPlan {
  toInstall: CurseForgeResolvedInstall[]
  optionalSkipped: MinecraftModDependency[]
  incompatible: MinecraftModDependency[]
}

/**
 * Same shape and reasoning as resolveModInstallPlan, adapted to CurseForge's own dependency
 * model: a file's `dependencies` are `{modId, relationType}` pairs rather than Modrinth's
 * `{project_id, version_id, dependency_type}` - there's no per-version pin like Modrinth's
 * `version_id`, so a required dependency always resolves to its own latest compatible file
 * (the same "no version picker" simplification this app already makes everywhere else).
 * relationType: 1 EmbeddedLibrary, 2 OptionalDependency, 3 RequiredDependency, 4 Tool,
 * 5 Incompatible, 6 Include - only 3 is walked/installed; 2 is surfaced; 5 is a warning only
 * if already installed; 1/4/6 are skipped outright (already bundled, not a mod, or a loader/
 * tool rather than something to drop in mods/plugins).
 */
export async function resolveCurseForgeInstallPlan(
  rootModId: number,
  rootFile: CurseForgeFile,
  profile: Pick<MinecraftProfile, 'serverType' | 'minecraftVersion'>,
  alreadyInstalledProjectIds: ReadonlySet<string>,
  deps: {
    getModFiles: (modId: number, serverType: MinecraftServerType, mcVersion: string) => Promise<CurseForgeFile[]>
  }
): Promise<CurseForgeInstallPlan> {
  const toInstall: CurseForgeResolvedInstall[] = [{ modId: rootModId, file: rootFile, installedAs: 'user' }]
  const seenModIds = new Set<string>([String(rootModId), ...alreadyInstalledProjectIds])
  const optionalSkipped: MinecraftModDependency[] = []
  const incompatible: MinecraftModDependency[] = []

  let queue: CurseForgeFileDependency[] = [...rootFile.dependencies]
  let depth = 0
  while (queue.length > 0 && depth < MAX_DEPENDENCY_DEPTH) {
    depth += 1
    const next: typeof queue = []
    for (const dep of queue) {
      const depId = String(dep.modId)

      if (dep.relationType === 1 || dep.relationType === 4 || dep.relationType === 6) continue

      if (dep.relationType === 5) {
        if (alreadyInstalledProjectIds.has(depId)) {
          incompatible.push({ projectId: depId, dependencyType: 'incompatible' })
        }
        continue
      }

      if (dep.relationType === 2) {
        if (!seenModIds.has(depId)) {
          optionalSkipped.push({ projectId: depId, dependencyType: 'optional' })
        }
        continue
      }

      // required (3)
      if (seenModIds.has(depId)) continue

      const files = await deps.getModFiles(dep.modId, profile.serverType, profile.minecraftVersion)
      const depFile = files[0]
      if (!depFile) continue

      seenModIds.add(depId)
      toInstall.push({ modId: dep.modId, file: depFile, installedAs: 'dependency' })
      next.push(...depFile.dependencies)
    }
    queue = next
  }

  return { toInstall, optionalSkipped, incompatible }
}

/** Downloads a CurseForge file straight to disk, verifying it against whichever hash
 *  CurseForge published for it (sha1, algo 1 - md5/algo 2 is skipped, same "prefer the
 *  stronger one, it's fine if only the weaker one is there" reasoning as Modrinth's own
 *  downloadVersionFile, just with CurseForge not always publishing sha1 at all). */
async function downloadCurseForgeFile(file: CurseForgeFile, targetPath: string): Promise<void> {
  if (!file.downloadUrl) {
    throw new Error(
      `"${file.displayName}" can't be downloaded automatically - its author disabled third-party distribution on CurseForge. Download it from the CurseForge website yourself, drop it in the mods/plugins folder, then use Rescan folder.`
    )
  }
  const response = await fetch(file.downloadUrl)
  if (!response.ok) {
    throw new Error(`Failed to download ${file.fileName} (HTTP ${response.status})`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())

  const expectedHash = file.hashes.find((h) => h.algo === 1)?.value
  if (expectedHash) {
    const actualHash = crypto.createHash('sha1').update(buffer).digest('hex')
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      throw new Error(`Downloaded ${file.fileName} failed its sha1 checksum - discarding it.`)
    }
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, buffer)
}

async function installResolvedCurseForgeFile(
  apiKey: string,
  modId: number,
  file: CurseForgeFile,
  installedAs: 'user' | 'dependency',
  targetDir: string
): Promise<InstalledMinecraftMod> {
  const mod = await getCurseForgeMod(apiKey, modId)

  removeExistingFile(targetDir, file.fileName)
  await downloadCurseForgeFile(file, path.join(targetDir, diskFileName(file.fileName, true)))

  return {
    source: 'curseforge',
    projectId: String(modId),
    slug: mod.slug,
    title: mod.name,
    iconUrl: mod.logo?.thumbnailUrl ?? undefined,
    versionId: String(file.id),
    versionNumber: file.displayName,
    fileName: file.fileName,
    enabled: true,
    installedAs,
    installedAt: Date.now()
  }
}

/** CurseForge counterpart to installModrinthMod - same "latest compatible file, walk required
 *  dependencies, preserve a previously-disabled mod's disabled state across reinstall" shape,
 *  adapted to CurseForge's own API (resolveCurseForgeInstallPlan instead of
 *  resolveModInstallPlan). Requires AppSettings.curseforgeApiKey to be set - the Mods tab only
 *  ever gets a source: 'curseforge' projectId to install from a search result, and a
 *  CurseForge search only happens once that key exists, but this is re-checked here too in
 *  case the key was cleared in between. */
async function installCurseForgeMod(
  profile: MinecraftProfile,
  projectId: string
): Promise<{ profile: MinecraftProfile; result: MinecraftModInstallResult }> {
  requireModsSupported(profile)
  const apiKey = getSettings().curseforgeApiKey.trim()
  if (!apiKey) {
    throw new Error('Set a CurseForge API key in Settings first.')
  }
  const modId = Number(projectId)
  const taskId = newTaskId('mc-mod-install')
  const taskLabel = `Install mod/plugin — ${profile.name}`
  logManagerEvent(taskId, taskLabel, `Resolving CurseForge mod ${modId}...`)

  const files = await getCurseForgeModFiles(apiKey, modId, profile.serverType, profile.minecraftVersion)
  const rootFile = files[0]
  if (!rootFile) {
    const message = "No file of this mod/plugin is compatible with this server's loader/Minecraft version."
    logManagerEvent(taskId, taskLabel, `Failed: ${message}`, 'error')
    throw new Error(message)
  }

  const alreadyInstalled = new Set(profile.installedMods.map((m) => m.projectId))
  const plan = await resolveCurseForgeInstallPlan(modId, rootFile, profile, alreadyInstalled, {
    getModFiles: (depModId, serverType, mcVersion) => getCurseForgeModFiles(apiKey, depModId, serverType, mcVersion)
  })

  const targetDir = modTargetDir(profile)
  const previousEnabledByProjectId = new Map(profile.installedMods.map((m) => [m.projectId, m.enabled]))
  const installedNow: InstalledMinecraftMod[] = []
  for (const { modId: installModId, file, installedAs } of plan.toInstall) {
    const installed = await installResolvedCurseForgeFile(apiKey, installModId, file, installedAs, targetDir)
    if (previousEnabledByProjectId.get(installed.projectId) === false) {
      const fromPath = path.join(targetDir, diskFileName(installed.fileName, true))
      const toPath = path.join(targetDir, diskFileName(installed.fileName, false))
      if (fs.existsSync(fromPath)) fs.renameSync(fromPath, toPath)
      installed.enabled = false
    }
    installedNow.push(installed)
  }

  const nextInstalledMods = [
    ...profile.installedMods.filter((m) => !installedNow.some((n) => n.projectId === m.projectId)),
    ...installedNow
  ]
  const updatedProfile: MinecraftProfile = { ...profile, installedMods: nextInstalledMods }
  saveMinecraftProfile(updatedProfile)

  logManagerEvent(
    taskId,
    taskLabel,
    `Installed ${installedNow.map((m) => m.title).join(', ')}${
      plan.toInstall.length > 1 ? ` (${plan.toInstall.length - 1} dependenc${plan.toInstall.length - 1 === 1 ? 'y' : 'ies'})` : ''
    }`
  )

  return {
    profile: updatedProfile,
    result: {
      installed: installedNow,
      dependenciesInstalled: installedNow.filter((m) => m.installedAs === 'dependency'),
      optionalDependenciesSkipped: plan.optionalSkipped,
      incompatibleWithInstalled: plan.incompatible
    }
  }
}

/** Dispatches to the right source's own install path - the Mods tab always has a `source`
 *  handy (either from a search result or from an already-installed entry), so this is the
 *  only install entry point the rest of the app (IPC, tests) needs to know about. */
export async function installMinecraftMod(
  profile: MinecraftProfile,
  source: MinecraftModSource,
  projectId: string
): Promise<{ profile: MinecraftProfile; result: MinecraftModInstallResult }> {
  if (source === 'modrinth') return installModrinthMod(profile, projectId)
  if (source === 'curseforge') return installCurseForgeMod(profile, projectId)
  throw new Error('Cannot install an unidentified mod - remove it and search for it by name instead.')
}

export function removeMinecraftMod(profile: MinecraftProfile, projectId: string): MinecraftProfile {
  const entry = profile.installedMods.find((m) => m.projectId === projectId)
  if (!entry) return profile

  const targetDir = modTargetDir(profile)
  removeExistingFile(targetDir, entry.fileName)

  const updatedProfile: MinecraftProfile = {
    ...profile,
    installedMods: profile.installedMods.filter((m) => m.projectId !== projectId)
  }
  saveMinecraftProfile(updatedProfile)
  logManagerEvent(newTaskId('mc-mod-remove'), `Remove mod/plugin — ${profile.name}`, `Removed ${entry.title}`)
  return updatedProfile
}

/** Enabling/disabling just renames the file on disk (`<name>.jar` <-> `<name>.jar.disabled`)
 *  rather than deleting it - every Forge/Fabric/Paper/Spigot loader only loads files ending
 *  in `.jar` from its mods/plugins folder, so this is enough to toggle it off without losing
 *  the file, and re-enabling needs no redownload. */
export function setMinecraftModEnabled(profile: MinecraftProfile, projectId: string, enabled: boolean): MinecraftProfile {
  const entry = profile.installedMods.find((m) => m.projectId === projectId)
  if (!entry || entry.enabled === enabled) return profile

  const targetDir = modTargetDir(profile)
  const fromPath = path.join(targetDir, diskFileName(entry.fileName, entry.enabled))
  const toPath = path.join(targetDir, diskFileName(entry.fileName, enabled))
  if (fs.existsSync(fromPath)) fs.renameSync(fromPath, toPath)

  const updatedProfile: MinecraftProfile = {
    ...profile,
    installedMods: profile.installedMods.map((m) => (m.projectId === projectId ? { ...m, enabled } : m))
  }
  saveMinecraftProfile(updatedProfile)
  return updatedProfile
}

/** Spreads out *dispatching* each item's async operation so the combined request rate stays
 *  well under a typical API's per-minute budget, even for a profile with hundreds of
 *  installed mods - firing every request in the very same tick (a plain `Promise.all(items.
 *  map(...))`) reliably tripped Modrinth's 300/req-per-minute limit for most of a large mods
 *  folder's worth of update checks at once. `perSecond` paces dispatch only (each call still
 *  runs concurrently once started - this isn't a concurrency cap), so overall throughput stays
 *  close to that rate without needlessly serializing anything. */
async function mapWithRateLimit<T, R>(items: T[], perSecond: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const intervalMs = 1000 / perSecond
  const results: R[] = new Array(items.length)
  await Promise.all(
    items.map(async (item, index) => {
      await delay(index * intervalMs)
      results[index] = await fn(item)
    })
  )
  return results
}

export async function checkMinecraftModUpdates(profile: MinecraftProfile): Promise<MinecraftModUpdateCheckResult[]> {
  requireModsSupported(profile)
  const apiKey = getSettings().curseforgeApiKey.trim()
  const results = await mapWithRateLimit(profile.installedMods, 4, async (mod): Promise<MinecraftModUpdateCheckResult | null> => {
    // 'unknown' entries (unidentified by scanForInstalledMods) have no real project id to
    // check against either source - skip rather than firing a doomed request for each one.
    if (mod.source === 'unknown') return null
    // A CurseForge entry with no API key configured (anymore) can't be checked either -
    // skip it the same way, rather than failing every other mod's check along with it.
    if (mod.source === 'curseforge' && !apiKey) return null

    try {
      if (mod.source === 'curseforge') {
        const files = await getCurseForgeModFiles(apiKey, Number(mod.projectId), profile.serverType, profile.minecraftVersion)
        const latest = files[0]
        return {
          projectId: mod.projectId,
          updateAvailable: latest !== undefined && String(latest.id) !== mod.versionId,
          latestVersionId: latest ? String(latest.id) : undefined,
          latestVersionNumber: latest?.displayName
        }
      }

      const versions = await getModrinthProjectVersions(mod.projectId, profile.serverType, profile.minecraftVersion)
      const latest = versions[0]
      return {
        projectId: mod.projectId,
        updateAvailable: latest !== undefined && latest.id !== mod.versionId,
        latestVersionId: latest?.id,
        latestVersionNumber: latest?.version_number
      }
    } catch {
      // A single mod's check failing (rate limit exhausted its own retries, a transient
      // network error, ...) shouldn't take the whole update check down with it the way a bare
      // Promise.all would - just skip it; the next "Check for updates" click retries it.
      return null
    }
  })
  return results.filter((r): r is MinecraftModUpdateCheckResult => r !== null)
}

/** Reinstalls a mod at its latest compatible version - same install path as a fresh install
 *  (including re-walking its dependencies, in case a newer version needs a new one), the old
 *  file is just replaced rather than left behind (see installResolvedVersion's own
 *  removeExistingFile call). */
export async function updateMinecraftMod(
  profile: MinecraftProfile,
  source: MinecraftModSource,
  projectId: string
): Promise<{ profile: MinecraftProfile; result: MinecraftModInstallResult }> {
  return installMinecraftMod(profile, source, projectId)
}

/** A file sitting in the mods/plugins folder that isn't in profile.installedMods yet - the
 *  on-disk name split back into its real file name and whether it's currently enabled, same
 *  convention as diskFileName/InstalledMinecraftMod.enabled. */
interface UntrackedModFile {
  diskName: string
  fileName: string
  enabled: boolean
}

function listUntrackedModFiles(targetDir: string, trackedFileNames: ReadonlySet<string>): UntrackedModFile[] {
  if (!fs.existsSync(targetDir)) return []
  return fs
    .readdirSync(targetDir)
    .filter((name) => name.endsWith('.jar') || name.endsWith(`.jar${DISABLED_SUFFIX}`))
    .map((diskName) => {
      const enabled = !diskName.endsWith(DISABLED_SUFFIX)
      const fileName = enabled ? diskName : diskName.slice(0, -DISABLED_SUFFIX.length)
      return { diskName, fileName, enabled }
    })
    .filter((file) => !trackedFileNames.has(file.fileName))
}

/** Synthetic projectId for an unidentified file - stable and unique per file name (nothing
 *  else in this app's own id space starts with "local:", and a real Modrinth project id never
 *  would either), so the same generic by-projectId remove/enable/disable logic used for
 *  Modrinth-sourced entries works for these too without a special case. */
function localModId(fileName: string): string {
  return `local:${fileName}`
}

/** Strips the trailing ".jar" for display - "worldedit-7.3.0.jar" reads better as
 *  "worldedit-7.3.0" when there's no real Modrinth title to show instead. */
function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.jar$/i, '')
}

/** Catches up installedMods entries that were already settled as source: 'modrinth' before the
 *  cross-listing feature existed, or before a CurseForge key was ever configured - without this,
 *  only a file freshly adopted *during* a scan (i.e. still in `untracked`) ever gets checked
 *  against CurseForge for cross-listing (see scanForInstalledMods' own `alsoOn` handling below),
 *  so an old entry could never show "Modrinth, CurseForge" no matter how many times Rescan
 *  folder is clicked - it's permanently excluded from `untracked` by `settledFileNames` the
 *  moment it's first matched. `alsoOn: []` (as opposed to leaving it `undefined`) marks an entry
 *  as "already checked, no cross-listing found" so it isn't re-queried on every single future
 *  scan forever - only entries that have truly never been checked (`alsoOn === undefined`) are
 *  considered here. Deliberately one-directional (Modrinth-primary entries checked against
 *  CurseForge, not the reverse) since that's the concrete case reported; a CurseForge-primary
 *  entry missing its Modrinth cross-listing can be added the same way later if it comes up. */
async function crossCheckSettledModrinthModsAgainstCurseForge(
  profile: MinecraftProfile,
  targetDir: string,
  apiKey: string
): Promise<MinecraftProfile> {
  const toCheck = profile.installedMods.filter((m) => m.source === 'modrinth' && m.alsoOn === undefined)
  if (toCheck.length === 0) return profile

  const fileByFingerprint = new Map<number, InstalledMinecraftMod>()
  for (const mod of toCheck) {
    const filePath = path.join(targetDir, diskFileName(mod.fileName, mod.enabled))
    if (!fs.existsSync(filePath)) continue
    const buffer = fs.readFileSync(filePath)
    fileByFingerprint.set(computeCurseForgeFingerprint(buffer), mod)
  }
  if (fileByFingerprint.size === 0) return profile

  const matchedProjectIds = new Set<string>()
  try {
    const matches = await getCurseForgeFingerprintMatches(apiKey, [...fileByFingerprint.keys()])
    for (const match of matches) {
      const mod = fileByFingerprint.get(match.file.fileFingerprint)
      if (mod) matchedProjectIds.add(mod.projectId)
    }
  } catch (err) {
    // Best-effort, same reasoning as the scan's own fingerprint check below - leave alsoOn
    // untouched entirely (not even set to []) so a transient failure here gets retried on the
    // next scan instead of being mistaken for "checked, nothing found".
    logManagerEvent(
      newTaskId('mc-mod-scan'),
      `Scan mods/plugins folder — ${profile.name}`,
      `CurseForge cross-listing check failed: ${(err as Error).message}`,
      'error'
    )
    return profile
  }

  return {
    ...profile,
    installedMods: profile.installedMods.map((m) => {
      if (m.source !== 'modrinth' || m.alsoOn !== undefined) return m
      return matchedProjectIds.has(m.projectId) ? { ...m, alsoOn: ['curseforge'] } : { ...m, alsoOn: [] }
    })
  }
}

/**
 * Recognizes mods/plugins already sitting in the folder that this app didn't itself install -
 * dropped in by hand, or installed before this feature existed. Identifies each untracked
 * `.jar`/`.jar.disabled` file by its sha1 hash against Modrinth (the same mechanism Modrinth's
 * own official app uses) and, if AppSettings.curseforgeApiKey is set, its CurseForge
 * "fingerprint" (murmur2 of the whitespace-stripped bytes - see curseforgeFingerprint.ts) -
 * both batched, one request per source regardless of how many files are untracked. Checked
 * against *every* untracked file's fingerprint, not just the ones Modrinth missed: some mod
 * authors upload an identical build to both sites, and a file matched by both ends up with
 * `alsoOn: ['curseforge']` on its (still Modrinth-sourced) entry rather than silently only
 * reporting one source. Every untracked file ends up in installedMods either way: a match from
 * either source becomes a full source: 'modrinth'/'curseforge' entry, and anything neither
 * source recognizes (hand-built, or genuinely not published to either) still becomes a source:
 * 'unknown' entry - still visible and manageable in the Mods tab, just without either source's
 * own metadata attached.
 *
 * Also runs crossCheckSettledModrinthModsAgainstCurseForge first (when a key is configured),
 * which backfills `alsoOn` on already-settled source: 'modrinth' entries from before the
 * cross-listing feature existed - otherwise only a file freshly seen as `untracked` this round
 * could ever gain that info, and an old entry would never show "Modrinth, CurseForge" no matter
 * how many times this is rerun.
 */
export async function scanForInstalledMods(
  profile: MinecraftProfile
): Promise<{ profile: MinecraftProfile; result: MinecraftModScanResult }> {
  requireLoaderSupportsMods(profile)
  const targetDir = modTargetDir(profile)
  // Only a real match (source: 'modrinth'/'curseforge') is "settled" and skipped on future
  // scans - an 'unknown' entry is re-examined every time instead of being excluded just
  // because it's already in installedMods. Without this, a file that couldn't be identified
  // the first time it was scanned would stay "Unidentified" forever even after this app
  // gained the ability to recognize it (a newly-configured CurseForge key, or CurseForge
  // adding/fixing a file's fingerprint on their end) - a real report had a CurseForge mod the
  // user could find by searching for it by name stay stuck as unidentified through repeated
  // Rescan folder clicks, because it had already been adopted as 'unknown' back when only
  // Modrinth hash-matching existed.
  const existingUnknownFileNames = new Set(
    profile.installedMods.filter((m) => m.source === 'unknown').map((m) => m.fileName)
  )
  const settledFileNames = new Set(
    profile.installedMods.filter((m) => m.source !== 'unknown').map((m) => m.fileName)
  )
  const untracked = listUntrackedModFiles(targetDir, settledFileNames)

  const apiKey = getSettings().curseforgeApiKey.trim()
  let workingProfile = profile
  if (apiKey) {
    workingProfile = await crossCheckSettledModrinthModsAgainstCurseForge(profile, targetDir, apiKey)
    if (workingProfile !== profile) {
      saveMinecraftProfile(workingProfile)
    }
  }

  if (untracked.length === 0) {
    return { profile: workingProfile, result: { adopted: [] } }
  }

  // Read every untracked file's bytes exactly once, computing both the sha1 (for Modrinth's
  // hash lookup) and the CurseForge fingerprint (murmur2 of the whitespace-stripped bytes -
  // see curseforgeFingerprint.ts) from the same buffer, rather than re-reading the file for
  // each source's own identification scheme.
  const fileByHash = new Map<string, UntrackedModFile>()
  const fileByFingerprint = new Map<number, UntrackedModFile>()
  for (const file of untracked) {
    const buffer = fs.readFileSync(path.join(targetDir, file.diskName))
    const hash = crypto.createHash('sha1').update(buffer).digest('hex')
    // A hash/fingerprint collision between two different untracked files is astronomically
    // unlikely and not worth guarding - at worst one of them is skipped this scan and picked
    // up (still correctly) on the next one, once the other has already been adopted and is no
    // longer "untracked".
    fileByHash.set(hash, file)
    fileByFingerprint.set(computeCurseForgeFingerprint(buffer), file)
  }

  const versionsByHash = await getModrinthVersionsFromHashes([...fileByHash.keys()], 'sha1')

  // One batched /projects request for every matched project, instead of one /project/{id}
  // request per adopted mod - a folder full of untracked mods used to cost one request each,
  // which was enough on its own to trip Modrinth's rate limit.
  const projectIds = [...new Set(Object.values(versionsByHash).map((v) => v.project_id))]
  const projects = await getModrinthProjects(projectIds)
  const projectById = new Map(projects.map((p) => [p.id, p]))

  const adopted: InstalledMinecraftMod[] = []
  for (const [hash, version] of Object.entries(versionsByHash)) {
    const file = fileByHash.get(hash)
    const project = projectById.get(version.project_id)
    if (!file || !project) continue
    adopted.push({
      source: 'modrinth',
      projectId: version.project_id,
      slug: project.slug,
      title: project.title,
      iconUrl: project.icon_url ?? undefined,
      versionId: version.id,
      versionNumber: version.version_number,
      fileName: file.fileName,
      enabled: file.enabled,
      installedAs: 'user',
      installedAt: Date.now()
    })
  }

  // Every untracked file's fingerprint is checked against CurseForge too, if a key is
  // configured - not just the ones Modrinth missed. Some mod authors upload an identical build
  // to both Modrinth and CurseForge, and a file already matched by Modrinth is still worth
  // checking so that case shows as "Modrinth, CurseForge" in the Mods tab (via `alsoOn` below)
  // instead of silently implying it's Modrinth-only.
  const matchedFileNames = new Set(adopted.map((m) => m.fileName))
  if (apiKey) {
    const allFingerprints = [...fileByFingerprint.keys()]

    if (allFingerprints.length > 0) {
      try {
        const matches = await getCurseForgeFingerprintMatches(apiKey, allFingerprints)
        const modIds = [...new Set(matches.map((match) => match.file.modId))]
        const mods = await getCurseForgeMods(apiKey, modIds)
        const modById = new Map(mods.map((mod) => [mod.id, mod]))

        for (const match of matches) {
          const file = fileByFingerprint.get(match.file.fileFingerprint)
          const mod = modById.get(match.file.modId)
          if (!file || !mod) continue

          const alreadyAdopted = adopted.find((m) => m.fileName === file.fileName)
          if (alreadyAdopted) {
            // Already matched by Modrinth this round - note the cross-listing rather than
            // adding a second, competing entry for the same file.
            if (!alreadyAdopted.alsoOn?.includes('curseforge')) {
              alreadyAdopted.alsoOn = [...(alreadyAdopted.alsoOn ?? []), 'curseforge']
            }
            continue
          }

          adopted.push({
            source: 'curseforge',
            projectId: String(match.file.modId),
            slug: mod.slug,
            title: mod.name,
            iconUrl: mod.logo?.thumbnailUrl ?? undefined,
            versionId: String(match.file.id),
            versionNumber: match.file.displayName,
            fileName: file.fileName,
            enabled: file.enabled,
            installedAs: 'user',
            installedAt: Date.now()
          })
          matchedFileNames.add(file.fileName)
        }
      } catch (err) {
        // Best-effort, same reasoning as the search path's own CurseForge try/catch - a
        // CurseForge failure here shouldn't stop Modrinth's already-found matches from being
        // adopted, it just means this round's leftovers fall through to 'unknown' below.
        logManagerEvent(newTaskId('mc-mod-scan'), `Scan mods/plugins folder — ${profile.name}`, `CurseForge fingerprint check failed: ${(err as Error).message}`, 'error')
      }
    }
  }

  // A file still unmatched after both sources either stays - or, if this is its first time
  // being seen, becomes - a source: 'unknown' entry. Skip ones already tracked as 'unknown'
  // from a previous scan rather than pushing a duplicate - they're already in
  // profile.installedMods and nothing about them changed this round.
  for (const file of untracked) {
    if (matchedFileNames.has(file.fileName) || existingUnknownFileNames.has(file.fileName)) continue
    adopted.push({
      source: 'unknown',
      projectId: localModId(file.fileName),
      slug: titleFromFileName(file.fileName),
      title: titleFromFileName(file.fileName),
      versionId: '',
      versionNumber: '',
      fileName: file.fileName,
      enabled: file.enabled,
      installedAs: 'user',
      installedAt: Date.now()
    })
  }

  // A file that just got a real match this round (modrinth/curseforge) replaces its stale
  // 'unknown' entry from a previous scan, rather than ending up tracked twice under the same
  // file name.
  const newlyIdentifiedFileNames = new Set(adopted.filter((m) => m.source !== 'unknown').map((m) => m.fileName))
  const updatedProfile: MinecraftProfile =
    adopted.length === 0
      ? workingProfile
      : {
          ...workingProfile,
          installedMods: [...workingProfile.installedMods.filter((m) => !newlyIdentifiedFileNames.has(m.fileName)), ...adopted]
        }
  if (adopted.length > 0) {
    saveMinecraftProfile(updatedProfile)
    logManagerEvent(
      newTaskId('mc-mod-scan'),
      `Scan mods/plugins folder — ${profile.name}`,
      `Recognized ${adopted.map((m) => m.title).join(', ')}`
    )
  }

  return {
    profile: updatedProfile,
    result: { adopted }
  }
}

/** Opens the mods/plugins folder in the OS file explorer - created first if it doesn't exist
 *  yet (a fresh install that's never had a mod/plugin dropped in). */
export async function openMinecraftModsFolder(profile: MinecraftProfile): Promise<void> {
  requireLoaderSupportsMods(profile)
  const targetDir = modTargetDir(profile)
  fs.mkdirSync(targetDir, { recursive: true })
  const error = await shell.openPath(targetDir)
  if (error) throw new Error(error)
}
