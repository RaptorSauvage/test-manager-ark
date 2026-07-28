import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ServerProfile } from '@shared/types'
import { isRunning } from './serverProcess'

/** Normalized for comparison only - lowercased since Windows filesystems are
 *  case-insensitive, so two differently-cased paths to the same folder should still
 *  count as "the same destination" rather than passing a same-folder check by accident. */
function normalizePath(p: string): string {
  return path.resolve(p.trim()).toLowerCase()
}

function assertDestinationIsUsable(destInstallDir: string, sourceInstallDir: string): void {
  if (!destInstallDir.trim()) {
    throw new Error('Choose a destination folder first.')
  }
  if (normalizePath(destInstallDir) === normalizePath(sourceInstallDir)) {
    throw new Error('Destination is the same as the current install folder.')
  }
  if (fs.existsSync(destInstallDir) && fs.readdirSync(destInstallDir).length > 0) {
    throw new Error('Destination folder already exists and is not empty.')
  }
}

/** Copies an entire server install to a new folder and registers it as a brand new
 *  profile (fresh id) with the given name - the original profile is untouched. */
export async function copyProfile(
  profile: ServerProfile,
  destInstallDir: string,
  newName: string
): Promise<ServerProfile> {
  if (isRunning(profile.id)) {
    throw new Error('Stop the server before copying it.')
  }
  assertDestinationIsUsable(destInstallDir, profile.installDir)

  await fs.promises.cp(profile.installDir, destInstallDir, { recursive: true })

  return { ...profile, id: randomUUID(), name: newName, installDir: destInstallDir }
}

/** Moves an entire server install to a new folder, updating the existing profile in
 *  place (same id) to point at it - rename included, since that's this app's normal way
 *  of renaming a profile, just paired with actually relocating its files. */
export async function moveProfile(
  profile: ServerProfile,
  destInstallDir: string,
  newName: string
): Promise<ServerProfile> {
  if (isRunning(profile.id)) {
    throw new Error('Stop the server before moving it.')
  }
  assertDestinationIsUsable(destInstallDir, profile.installDir)

  try {
    await fs.promises.rename(profile.installDir, destInstallDir)
  } catch (err) {
    // EXDEV: rename() can't cross filesystems/drives (e.g. C: -> D:) - fall back to a
    // real copy then remove the original, same net effect just slower.
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await fs.promises.cp(profile.installDir, destInstallDir, { recursive: true })
    await fs.promises.rm(profile.installDir, { recursive: true, force: true })
  }

  return { ...profile, name: newName, installDir: destInstallDir }
}
