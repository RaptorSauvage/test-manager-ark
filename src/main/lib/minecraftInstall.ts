import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import type { MinecraftInstallParams, MinecraftInstallResult, MinecraftVersionOption } from '@shared/minecraftInstall'
import { detectMinecraftLaunchable } from './minecraftDetect'
import { logManagerEvent, newTaskId } from './managerLog'
import {
  listVanillaVersions,
  getVanillaServerDownload,
  listPaperVersions,
  getLatestPaperBuild,
  getPaperBuild,
  listPaperBuildOptions,
  listFabricGameVersions,
  getLatestFabricLoaderVersion,
  getLatestFabricInstallerVersion,
  listFabricLoaderOptions,
  fabricServerJarUrl,
  listForgeMinecraftVersions,
  forgeInstallerUrl,
  listForgeLoaderOptions,
  listNeoForgeMinecraftVersions,
  neoForgeInstallerUrl,
  neoForgeVersionToMinecraftVersion,
  listNeoForgeLoaderOptions,
  listSpongeMinecraftVersions,
  listSpongeLoaderOptions,
  spongeDownloadUrl,
  SPIGOT_BUILDTOOLS_URL
} from './minecraftInstallClient'

/**
 * Fetches/builds the right server files for a brand-new Minecraft server, so "+ Add server"
 * no longer requires already having a jar/script sitting in a folder somewhere (that's what
 * "Import existing server" is for) - one function per loader, dispatched by
 * installMinecraftServerFiles below. See minecraftInstallClient.ts's own top-of-file comment
 * for the caveat that none of this could be verified against the real APIs from this sandbox.
 *
 * Two-selector model: the Install dialog (and Start Settings) show a Minecraft version picker
 * plus, for every type except vanilla/Spigot (see shared/minecraftInstall.ts's
 * supportsLoaderVersionSelection), a second loader/build-version picker - listed by
 * listInstallableMinecraftVersions and listInstallableLoaderVersions respectively, the latter
 * depending on the former's pick. This replaced an earlier single-selector design where
 * Forge/NeoForge showed one flat list of "<mcVersion>-<build>"-style combo strings.
 */

export async function listInstallableMinecraftVersions(
  serverType: MinecraftInstallParams['serverType']
): Promise<MinecraftVersionOption[]> {
  if (serverType === 'vanilla' || serverType === 'spigot') {
    // Spigot's BuildTools can target any Mojang-published version in principle, but only ones
    // it actually has mappings for reliably succeed - Vanilla's own release list is the
    // closest available proxy for "a version that plausibly works", same list vanilla itself
    // offers.
    return (await listVanillaVersions()).map((v) => ({ id: v.id, label: v.id }))
  }
  if (serverType === 'paper') return (await listPaperVersions()).map((id) => ({ id, label: id }))
  if (serverType === 'fabric') return (await listFabricGameVersions()).map((id) => ({ id, label: id }))
  if (serverType === 'forge') return (await listForgeMinecraftVersions()).map((id) => ({ id, label: id }))
  if (serverType === 'neoforge') return (await listNeoForgeMinecraftVersions()).map((id) => ({ id, label: id }))
  // spongevanilla / spongeforge
  const artifactId = serverType === 'spongevanilla' ? 'spongevanilla' : 'spongeforge'
  return (await listSpongeMinecraftVersions(artifactId)).map((id) => ({ id, label: id }))
}

/** Loader/build-version options for the second selector, once a Minecraft version has been
 *  picked in the first - empty for vanilla/Spigot (see supportsLoaderVersionSelection), which
 *  have nothing further to choose. */
export async function listInstallableLoaderVersions(
  serverType: MinecraftInstallParams['serverType'],
  minecraftVersion: string
): Promise<MinecraftVersionOption[]> {
  if (serverType === 'vanilla' || serverType === 'spigot') return []
  if (serverType === 'paper') return listPaperBuildOptions(minecraftVersion)
  if (serverType === 'fabric') return listFabricLoaderOptions(minecraftVersion)
  if (serverType === 'forge') return listForgeLoaderOptions(minecraftVersion)
  if (serverType === 'neoforge') return listNeoForgeLoaderOptions(minecraftVersion)
  const artifactId = serverType === 'spongevanilla' ? 'spongevanilla' : 'spongeforge'
  return listSpongeLoaderOptions(artifactId, minecraftVersion)
}

async function downloadToFile(url: string, destPath: string, expectedHash?: { algorithm: string; hex: string }): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed (HTTP ${response.status}): ${url}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (expectedHash) {
    const actual = crypto.createHash(expectedHash.algorithm).update(buffer).digest('hex')
    if (actual.toLowerCase() !== expectedHash.hex.toLowerCase()) {
      throw new Error(`Downloaded file failed its ${expectedHash.algorithm} checksum - discarding it: ${url}`)
    }
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, buffer)
}

function writeEula(installDir: string): void {
  fs.writeFileSync(
    path.join(installDir, 'eula.txt'),
    '# Written by Bober Server Manager - you agreed to this when installing the server.\neula=true\n',
    'utf-8'
  )
}

/** Fails clearly up front rather than letting a long download/build run and then crash on
 *  spawn('java', ...)/spawn('git', ...) with a bare ENOENT. */
function requireExecutableOnPath(command: string, friendlyName: string): void {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore' })
  if (result.error || result.status === null) {
    throw new Error(`${friendlyName} was not found on PATH - install it first and make sure "${command}" works from a terminal.`)
  }
}

function runProcess(command: string, args: string[], cwd: string, taskId: string, taskLabel: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'ignore' })
    child.on('error', (err) => reject(err))
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })
    void taskId
    void taskLabel
  })
}

async function installVanillaServer(installDir: string, minecraftVersion: string): Promise<MinecraftInstallResult> {
  const entry = (await listVanillaVersions()).find((v) => v.id === minecraftVersion)
  if (!entry) throw new Error(`Unknown Minecraft version: ${minecraftVersion}`)
  const download = await getVanillaServerDownload(entry.url)
  if (!download) throw new Error(`Minecraft ${minecraftVersion} has no standalone server download.`)
  await downloadToFile(download.url, path.join(installDir, 'server.jar'), { algorithm: 'sha1', hex: download.sha1 })
  return { installDir, launchMode: 'jar', jarFileName: 'server.jar', scriptFileName: '', minecraftVersion, serverType: 'vanilla' }
}

async function installPaperServer(installDir: string, minecraftVersion: string, loaderVersion?: string): Promise<MinecraftInstallResult> {
  const { build, fileName, sha256, url } = loaderVersion
    ? await getPaperBuild(minecraftVersion, Number(loaderVersion))
    : await getLatestPaperBuild(minecraftVersion)
  await downloadToFile(url, path.join(installDir, fileName), { algorithm: 'sha256', hex: sha256 })
  return {
    installDir,
    launchMode: 'jar',
    jarFileName: fileName,
    scriptFileName: '',
    minecraftVersion,
    loaderVersion: String(build),
    serverType: 'paper'
  }
}

async function installFabricServer(installDir: string, minecraftVersion: string, loaderVersion?: string): Promise<MinecraftInstallResult> {
  const resolvedLoaderVersion = loaderVersion || (await getLatestFabricLoaderVersion(minecraftVersion))
  const installerVersion = await getLatestFabricInstallerVersion()
  const jarFileName = 'fabric-server-launch.jar'
  // Fabric's meta server builds this jar per-request rather than publishing a fixed file with
  // a checksum - nothing to verify it against, unlike vanilla/Paper above.
  await downloadToFile(
    fabricServerJarUrl(minecraftVersion, resolvedLoaderVersion, installerVersion),
    path.join(installDir, jarFileName)
  )
  return {
    installDir,
    launchMode: 'jar',
    jarFileName,
    scriptFileName: '',
    minecraftVersion,
    loaderVersion: resolvedLoaderVersion,
    serverType: 'fabric'
  }
}

async function resolveForgeVersion(minecraftVersion: string, loaderVersion?: string): Promise<string> {
  if (loaderVersion) return loaderVersion
  const options = await listForgeLoaderOptions(minecraftVersion)
  const picked = options.find((o) => o.recommended) ?? options[0]
  if (!picked) throw new Error(`No Forge builds found for Minecraft ${minecraftVersion}.`)
  return picked.id
}

async function installForgeServer(
  installDir: string,
  minecraftVersion: string,
  loaderVersion: string | undefined,
  taskId: string
): Promise<MinecraftInstallResult> {
  const forgeVersion = await resolveForgeVersion(minecraftVersion, loaderVersion)
  requireExecutableOnPath('java', 'Java')
  const installerPath = path.join(installDir, 'forge-installer.jar')
  await downloadToFile(forgeInstallerUrl(minecraftVersion, forgeVersion), installerPath)
  logManagerEvent(taskId, `Install Minecraft server (Forge ${minecraftVersion}-${forgeVersion})`, 'Running the Forge installer...')
  await runProcess('java', ['-jar', 'forge-installer.jar', '--installServer'], installDir, taskId, 'Forge install')
  const detected = detectMinecraftLaunchable(installDir)
  if (!detected) {
    throw new Error('The Forge installer ran, but no launchable jar or script was found afterward - check the Forge install log in the install directory.')
  }
  // serverType is forced to 'forge' regardless of what detectMinecraftLaunchable's generic
  // jar-name heuristic guessed - this install path is definitely Forge, no need to guess.
  return { ...detected, installDir, minecraftVersion, loaderVersion: forgeVersion, serverType: 'forge' }
}

async function installNeoForgeServer(
  installDir: string,
  minecraftVersion: string,
  loaderVersion: string | undefined,
  taskId: string
): Promise<MinecraftInstallResult> {
  let neoForgeVersion = loaderVersion
  if (!neoForgeVersion) {
    const options = await listNeoForgeLoaderOptions(minecraftVersion)
    const picked = options.find((o) => o.recommended) ?? options[0]
    if (!picked) throw new Error(`No NeoForge builds found for Minecraft ${minecraftVersion}.`)
    neoForgeVersion = picked.id
  }
  // Validated up front, before any network/installer work - same fail-fast behavior as every
  // other check in this function, rather than discovering a malformed loaderVersion only
  // after downloading and running the installer.
  const derivedMinecraftVersion = neoForgeVersionToMinecraftVersion(neoForgeVersion)
  requireExecutableOnPath('java', 'Java')
  const installerPath = path.join(installDir, 'neoforge-installer.jar')
  await downloadToFile(neoForgeInstallerUrl(neoForgeVersion), installerPath)
  logManagerEvent(taskId, `Install Minecraft server (NeoForge ${neoForgeVersion})`, 'Running the NeoForge installer...')
  await runProcess('java', ['-jar', 'neoforge-installer.jar', '--installServer'], installDir, taskId, 'NeoForge install')
  const detected = detectMinecraftLaunchable(installDir)
  if (!detected) {
    throw new Error('The NeoForge installer ran, but no launchable jar or script was found afterward - check the install directory.')
  }
  // serverType is forced to 'neoforge' regardless of what detectMinecraftLaunchable's generic
  // heuristic guessed - this install path is definitely NeoForge, no need to guess.
  return {
    ...detected,
    installDir,
    minecraftVersion: derivedMinecraftVersion,
    loaderVersion: neoForgeVersion,
    serverType: 'neoforge'
  }
}

/** SpongeVanilla ships as a complete, standalone server jar (same "one downloadable jar,
 *  nothing to run" shape as vanilla/Paper/Fabric) - see minecraftInstallClient.ts's own Sponge
 *  section for the real caveats around this (unverified download API, assumed file name). */
async function installSpongeVanillaServer(
  installDir: string,
  minecraftVersion: string,
  loaderVersion?: string
): Promise<MinecraftInstallResult> {
  const buildVersion = loaderVersion || (await resolveNewestSpongeBuild('spongevanilla', minecraftVersion))
  const jarFileName = 'spongevanilla.jar'
  await downloadToFile(spongeDownloadUrl('spongevanilla', minecraftVersion, buildVersion), path.join(installDir, jarFileName))
  return {
    installDir,
    launchMode: 'jar',
    jarFileName,
    scriptFileName: '',
    minecraftVersion,
    loaderVersion: buildVersion,
    serverType: 'spongevanilla'
  }
}

/** SpongeForge is a mod, not a standalone server - it needs a real Forge server installed
 *  first and then drops its own jar into mods/ on top of it. Which exact Forge build it
 *  needs isn't exposed by Sponge's Maven listing at all (see minecraftInstallClient.ts's own
 *  Sponge section) - this installs whichever Forge build is "recommended" for the same
 *  Minecraft version instead, a reasonable default but not a verified-compatible pairing. */
async function installSpongeForgeServer(
  installDir: string,
  minecraftVersion: string,
  loaderVersion: string | undefined,
  taskId: string
): Promise<MinecraftInstallResult> {
  const forgeResult = await installForgeServer(installDir, minecraftVersion, undefined, taskId)
  const buildVersion = loaderVersion || (await resolveNewestSpongeBuild('spongeforge', minecraftVersion))
  logManagerEvent(taskId, `Install Minecraft server (SpongeForge ${minecraftVersion}-${buildVersion})`, 'Downloading SpongeForge...')
  const modsDir = path.join(installDir, 'mods')
  await downloadToFile(
    spongeDownloadUrl('spongeforge', minecraftVersion, buildVersion),
    path.join(modsDir, `spongeforge-${minecraftVersion}-${buildVersion}.jar`)
  )
  // Keeps whatever Forge already detected (launchMode/jarFileName/scriptFileName) - SpongeForge
  // doesn't change how the server launches, it's a mod Forge itself loads at startup.
  // loaderVersion is overridden to the SpongeForge build actually installed (what the second
  // selector picked), not the underlying Forge build installForgeServer resolved for itself.
  return { ...forgeResult, loaderVersion: buildVersion, serverType: 'spongeforge' }
}

async function resolveNewestSpongeBuild(artifactId: 'spongevanilla' | 'spongeforge', minecraftVersion: string): Promise<string> {
  const options = await listSpongeLoaderOptions(artifactId, minecraftVersion)
  const picked = options.find((o) => o.recommended) ?? options[0]
  if (!picked) throw new Error(`No ${artifactId === 'spongevanilla' ? 'SpongeVanilla' : 'SpongeForge'} builds found for Minecraft ${minecraftVersion}.`)
  return picked.id
}

async function installSpigotServer(installDir: string, minecraftVersion: string, taskId: string): Promise<MinecraftInstallResult> {
  requireExecutableOnPath('java', 'Java')
  requireExecutableOnPath('git', 'Git')
  const buildToolsPath = path.join(installDir, 'BuildTools.jar')
  await downloadToFile(SPIGOT_BUILDTOOLS_URL, buildToolsPath)
  logManagerEvent(
    taskId,
    `Install Minecraft server (Spigot ${minecraftVersion})`,
    'Running BuildTools - this compiles Spigot from source and can take several minutes...'
  )
  await runProcess('java', ['-jar', 'BuildTools.jar', '--rev', minecraftVersion], installDir, taskId, 'Spigot BuildTools')
  const jarFileName = `spigot-${minecraftVersion}.jar`
  if (!fs.existsSync(path.join(installDir, jarFileName))) {
    throw new Error(`BuildTools finished, but ${jarFileName} wasn't found in ${installDir} afterward.`)
  }
  return { installDir, launchMode: 'jar', jarFileName, scriptFileName: '', minecraftVersion, serverType: 'spigot' }
}

export async function installMinecraftServerFiles(params: MinecraftInstallParams): Promise<MinecraftInstallResult> {
  if (!params.acceptEula) {
    throw new Error('You must accept the Minecraft EULA (https://www.minecraft.net/eula) to install a server.')
  }
  if (!params.minecraftVersion.trim()) {
    throw new Error('Pick a Minecraft version first.')
  }

  const taskId = newTaskId('mc-install')
  const taskLabel = `Install Minecraft server (${params.serverType} ${params.minecraftVersion})`
  logManagerEvent(taskId, taskLabel, 'Started')
  fs.mkdirSync(params.installDir, { recursive: true })

  try {
    let result: MinecraftInstallResult
    if (params.serverType === 'vanilla') result = await installVanillaServer(params.installDir, params.minecraftVersion)
    else if (params.serverType === 'paper')
      result = await installPaperServer(params.installDir, params.minecraftVersion, params.loaderVersion)
    else if (params.serverType === 'fabric')
      result = await installFabricServer(params.installDir, params.minecraftVersion, params.loaderVersion)
    else if (params.serverType === 'forge')
      result = await installForgeServer(params.installDir, params.minecraftVersion, params.loaderVersion, taskId)
    else if (params.serverType === 'neoforge')
      result = await installNeoForgeServer(params.installDir, params.minecraftVersion, params.loaderVersion, taskId)
    else if (params.serverType === 'spongevanilla')
      result = await installSpongeVanillaServer(params.installDir, params.minecraftVersion, params.loaderVersion)
    else if (params.serverType === 'spongeforge')
      result = await installSpongeForgeServer(params.installDir, params.minecraftVersion, params.loaderVersion, taskId)
    else result = await installSpigotServer(params.installDir, params.minecraftVersion, taskId)

    writeEula(params.installDir)
    logManagerEvent(taskId, taskLabel, `Completed: ${result.jarFileName || result.scriptFileName}`)
    return result
  } catch (err) {
    logManagerEvent(taskId, taskLabel, `Failed: ${(err as Error).message}`, 'error')
    throw err
  }
}
