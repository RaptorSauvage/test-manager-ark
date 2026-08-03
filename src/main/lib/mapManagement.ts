import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import type { ServerProfile, MapFolderEntry } from '@shared/types'

/** The SavedArks folder itself, not any particular map's subfolder under it - every map
 *  this install has ever loaded (plus anything created here) gets its own subfolder there. */
function savedArksRoot(profile: ServerProfile): string {
  return path.join(profile.installDir, 'ShooterGame', 'Saved', 'SavedArks')
}

/**
 * A plain folder/file name with no path separators or traversal - this is user-typed input
 * used to build a filesystem path, so it's the one place in this feature that has to guard
 * against writing outside SavedArks (e.g. "..", or an embedded "/"). Returns the sanitized
 * name, throwing a clear error instead of silently altering what the user typed.
 */
export function sanitizeMapFolderName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[/\\]/.test(trimmed)) {
    throw new Error(`"${name}" isn't a valid folder/file name.`)
  }
  return trimmed
}

/** Every subfolder directly under SavedArks, sorted alphabetically. */
export function listMapFolders(profile: ServerProfile): MapFolderEntry[] {
  const root = savedArksRoot(profile)
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const stat = fs.statSync(path.join(root, entry.name))
      return { name: entry.name, createdAt: stat.birthtimeMs || stat.mtimeMs }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Creates a map's folder under SavedArks with an empty placeholder .ark file inside -
 * enough structure for a custom map to exist before its mod is actually installed (per
 * the Mod Management tab). Does not overwrite an existing file of the same name.
 */
export function createMapFolder(profile: ServerProfile, folderName: string, fileName: string): void {
  const folder = sanitizeMapFolderName(folderName)
  const file = sanitizeMapFolderName(fileName)
  const dir = path.join(savedArksRoot(profile), folder)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, file)
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '')
}

export function deleteMapFolder(profile: ServerProfile, folderName: string): void {
  const folder = sanitizeMapFolderName(folderName)
  fs.rmSync(path.join(savedArksRoot(profile), folder), { recursive: true, force: true })
}

export async function openMapFolder(profile: ServerProfile, folderName: string): Promise<void> {
  const folder = sanitizeMapFolderName(folderName)
  const dir = path.join(savedArksRoot(profile), folder)
  fs.mkdirSync(dir, { recursive: true })
  const error = await shell.openPath(dir)
  if (error) throw new Error(error)
}
