import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import AdmZip from 'adm-zip'

const DOWNLOAD_URLS: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip',
  linux: 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz',
  darwin: 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz'
}

/**
 * Base folder the Manager itself lives in: the project root in dev (electron-vite
 * runs main from `out/main`, two levels below the root), or the folder containing
 * the executable once packaged - not the OS's hidden per-user AppData folder, so
 * it's somewhere the user can actually find and browse to.
 */
export function getManagerBaseDir(): string {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath()
}

/** Where this app keeps its own SteamCMD copy, separate from any install the user points to manually. */
export function getManagedSteamCmdDir(): string {
  return path.join(getManagerBaseDir(), 'steamcmd')
}

export function getManagedExecutablePath(dir: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? path.join(dir, 'steamcmd.exe') : path.join(dir, 'steamcmd.sh')
}

/** Returns the managed executable's path if it's already installed, else null. */
export function getManagedSteamCmdStatus(): string | null {
  const dir = getManagedSteamCmdDir()
  const exe = getManagedExecutablePath(dir)
  return fs.existsSync(exe) ? exe : null
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download SteamCMD (HTTP ${response.status})`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(destPath, buffer)
}

function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archivePath, '-C', destDir])
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`))))
  })
}

/** Downloads and extracts SteamCMD straight from Valve's CDN into the app's managed folder. */
export async function installManagedSteamCmd(): Promise<string> {
  const url = DOWNLOAD_URLS[process.platform]
  if (!url) {
    throw new Error(`No SteamCMD download is available for platform "${process.platform}".`)
  }

  const dir = getManagedSteamCmdDir()
  fs.mkdirSync(dir, { recursive: true })

  const archivePath = path.join(dir, path.basename(url))
  await downloadFile(url, archivePath)

  try {
    if (url.endsWith('.zip')) {
      new AdmZip(archivePath).extractAllTo(dir, true)
    } else {
      await extractTarGz(archivePath, dir)
    }
  } finally {
    fs.rmSync(archivePath, { force: true })
  }

  const exePath = getManagedExecutablePath(dir)
  if (!fs.existsSync(exePath)) {
    throw new Error('SteamCMD download completed but the executable was not found afterwards.')
  }
  if (process.platform !== 'win32') {
    fs.chmodSync(exePath, 0o755)
  }
  return exePath
}
