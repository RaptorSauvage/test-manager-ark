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
  paperDownloadUrl,
  listFabricGameVersions,
  getLatestFabricLoaderVersion,
  getLatestFabricInstallerVersion,
  fabricServerJarUrl,
  listForgeVersionsForMinecraft,
  forgeInstallerUrl,
  SPIGOT_BUILDTOOLS_URL
} from './minecraftInstallClient'

/**
 * Fetches/builds the right server files for a brand-new Minecraft server, so "+ Add server"
 * no longer requires already having a jar/script sitting in a folder somewhere (that's what
 * "Import existing server" is for) - one function per loader, dispatched by
 * installMinecraftServerFiles below. See minecraftInstallClient.ts's own top-of-file comment
 * for the caveat that none of this could be verified against the real APIs from this sandbox.
 */

export async function listInstallableMinecraftVersions(
  serverType: MinecraftInstallParams['serverType']
): Promise<MinecraftVersionOption[]> {
  if (serverType === 'vanilla' || serverType === 'paper') {
    const versions = serverType === 'vanilla' ? (await listVanillaVersions()).map((v) => v.id) : await listPaperVersions()
    return versions.map((id) => ({ id, label: id }))
  }
  if (serverType === 'fabric') {
    const versions = await listFabricGameVersions()
    return versions.map((id) => ({ id, label: id }))
  }
  if (serverType === 'spigot') {
    // BuildTools can target any Mojang-published version in principle, but only ones it
    // actually has mappings for reliably succeed - Vanilla's own release list is the closest
    // available proxy for "a version that plausibly works", same list vanilla itself offers.
    const versions = await listVanillaVersions()
    return versions.map((v) => ({ id: v.id, label: v.id }))
  }
  // forge: list every mcVersion-forgeVersion combo on Forge's own maven across every version,
  // then present the combined string as the selectable "version" - Forge itself doesn't offer
  // "latest build for mcVersion" as a separate pick, it's all one flat list.
  const combos = await listAllForgeCombos()
  return combos.map((id) => ({ id, label: id }))
}

/** Forge's maven-metadata.xml lists every published mcVersion-forgeVersion combo flatly, with
 *  no per-mcVersion grouping endpoint - listForgeVersionsForMinecraft needs an mcVersion to
 *  filter by, so this walks the small set of Minecraft versions Forge has ever targeted by
 *  asking Vanilla's own release list and checking each one, skipping any with no Forge builds
 *  at all. Kept simple rather than parsing the metadata file's version list order into actual
 *  Minecraft versions (Forge's own combo strings aren't reliably splittable without knowing
 *  the Minecraft version first - that's exactly why this asks per-version instead). */
async function listAllForgeCombos(): Promise<string[]> {
  const mcVersions = (await listVanillaVersions()).map((v) => v.id)
  const combos: string[] = []
  for (const mcVersion of mcVersions.slice(0, 20)) {
    const forVersion = await listForgeVersionsForMinecraft(mcVersion).catch(() => [])
    combos.push(...forVersion)
    // Stop once a few versions' worth have been found - Forge support starts a couple of
    // versions behind the very latest release most of the time, and walking the entire
    // multi-hundred-version Vanilla history just to list Forge builds would be needlessly
    // slow for a dropdown the user only needs the last handful of versions in anyway.
    if (combos.length >= 20) break
  }
  return combos
}

function splitForgeCombo(combo: string): { mcVersion: string; forgeVersion: string } {
  const dash = combo.indexOf('-')
  if (dash === -1) throw new Error(`Not a valid Forge version ("<minecraft>-<forge>" expected): ${combo}`)
  return { mcVersion: combo.slice(0, dash), forgeVersion: combo.slice(dash + 1) }
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

async function installPaperServer(installDir: string, minecraftVersion: string): Promise<MinecraftInstallResult> {
  const { build, fileName, sha256 } = await getLatestPaperBuild(minecraftVersion)
  await downloadToFile(paperDownloadUrl(minecraftVersion, build, fileName), path.join(installDir, fileName), {
    algorithm: 'sha256',
    hex: sha256
  })
  return { installDir, launchMode: 'jar', jarFileName: fileName, scriptFileName: '', minecraftVersion, serverType: 'paper' }
}

async function installFabricServer(installDir: string, minecraftVersion: string): Promise<MinecraftInstallResult> {
  const loaderVersion = await getLatestFabricLoaderVersion(minecraftVersion)
  const installerVersion = await getLatestFabricInstallerVersion()
  const jarFileName = 'fabric-server-launch.jar'
  // Fabric's meta server builds this jar per-request rather than publishing a fixed file with
  // a checksum - nothing to verify it against, unlike vanilla/Paper above.
  await downloadToFile(fabricServerJarUrl(minecraftVersion, loaderVersion, installerVersion), path.join(installDir, jarFileName))
  return { installDir, launchMode: 'jar', jarFileName, scriptFileName: '', minecraftVersion, serverType: 'fabric' }
}

async function installForgeServer(installDir: string, versionCombo: string, taskId: string): Promise<MinecraftInstallResult> {
  const { mcVersion, forgeVersion } = splitForgeCombo(versionCombo)
  requireExecutableOnPath('java', 'Java')
  const installerPath = path.join(installDir, 'forge-installer.jar')
  await downloadToFile(forgeInstallerUrl(mcVersion, forgeVersion), installerPath)
  logManagerEvent(taskId, `Install Minecraft server (Forge ${versionCombo})`, 'Running the Forge installer...')
  await runProcess('java', ['-jar', 'forge-installer.jar', '--installServer'], installDir, taskId, 'Forge install')
  const detected = detectMinecraftLaunchable(installDir)
  if (!detected) {
    throw new Error('The Forge installer ran, but no launchable jar or script was found afterward - check the Forge install log in the install directory.')
  }
  // serverType is forced to 'forge' regardless of what detectMinecraftLaunchable's generic
  // jar-name heuristic guessed - this install path is definitely Forge, no need to guess.
  return { ...detected, installDir, minecraftVersion: mcVersion, serverType: 'forge' }
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
    else if (params.serverType === 'paper') result = await installPaperServer(params.installDir, params.minecraftVersion)
    else if (params.serverType === 'fabric') result = await installFabricServer(params.installDir, params.minecraftVersion)
    else if (params.serverType === 'forge') result = await installForgeServer(params.installDir, params.minecraftVersion, taskId)
    else result = await installSpigotServer(params.installDir, params.minecraftVersion, taskId)

    writeEula(params.installDir)
    logManagerEvent(taskId, taskLabel, `Completed: ${result.jarFileName || result.scriptFileName}`)
    return result
  } catch (err) {
    logManagerEvent(taskId, taskLabel, `Failed: ${(err as Error).message}`, 'error')
    throw err
  }
}
