import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { MinecraftProfile, MinecraftServerType } from '@shared/minecraft'
import { supportsMinecraftMods } from '@shared/minecraftMods'
import type {
  MinecraftModSearchResult,
  MinecraftModInstallResult,
  MinecraftModDependency,
  InstalledMinecraftMod,
  MinecraftModUpdateCheckResult
} from '@shared/minecraftMods'
import {
  searchModrinthProjects,
  getModrinthProjectVersions,
  getModrinthVersion,
  getModrinthProject,
  type ModrinthVersion,
  type ModrinthVersionFile
} from './modrinthClient'
import { saveMinecraftProfile } from '../store'
import { logManagerEvent, newTaskId } from './managerLog'

/** Forge/Fabric read mods from `mods/`; Paper/Spigot read plugins from `plugins/`. */
export function modTargetDir(profile: MinecraftProfile): string {
  const sub = profile.serverType === 'forge' || profile.serverType === 'fabric' ? 'mods' : 'plugins'
  return path.join(profile.installDir, sub)
}

function requireModsSupported(profile: MinecraftProfile): void {
  if (!supportsMinecraftMods(profile.serverType)) {
    throw new Error('This server type has no mod/plugin ecosystem - set Server type in Start Settings first.')
  }
  if (!profile.minecraftVersion.trim()) {
    throw new Error("Set this server's Minecraft version in Start Settings first.")
  }
}

export async function searchMinecraftMods(profile: MinecraftProfile, query: string): Promise<MinecraftModSearchResult[]> {
  requireModsSupported(profile)
  const hits = await searchModrinthProjects(query, profile.serverType, profile.minecraftVersion)
  const installedIds = new Set(profile.installedMods.map((m) => m.projectId))
  return hits.map((hit) => ({
    source: 'modrinth' as const,
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    iconUrl: hit.icon_url ?? undefined,
    downloads: hit.downloads,
    installed: installedIds.has(hit.project_id)
  }))
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

function diskFileName(fileName: string, enabled: boolean): string {
  return enabled ? fileName : `${fileName}.disabled`
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
export async function installMinecraftMod(
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

export async function checkMinecraftModUpdates(profile: MinecraftProfile): Promise<MinecraftModUpdateCheckResult[]> {
  requireModsSupported(profile)
  return Promise.all(
    profile.installedMods.map(async (mod): Promise<MinecraftModUpdateCheckResult> => {
      const versions = await getModrinthProjectVersions(mod.projectId, profile.serverType, profile.minecraftVersion)
      const latest = versions[0]
      return {
        projectId: mod.projectId,
        updateAvailable: latest !== undefined && latest.id !== mod.versionId,
        latestVersionId: latest?.id,
        latestVersionNumber: latest?.version_number
      }
    })
  )
}

/** Reinstalls a mod at its latest compatible version - same install path as a fresh install
 *  (including re-walking its dependencies, in case a newer version needs a new one), the old
 *  file is just replaced rather than left behind (see installResolvedVersion's own
 *  removeExistingFile call). */
export async function updateMinecraftMod(
  profile: MinecraftProfile,
  projectId: string
): Promise<{ profile: MinecraftProfile; result: MinecraftModInstallResult }> {
  return installMinecraftMod(profile, projectId)
}
