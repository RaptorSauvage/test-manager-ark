import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { platform } from 'node:process'
import { detectMinecraftLaunchable, isValidMinecraftInstall, detectMinecraftProfile } from '../src/main/lib/minecraftDetect'

describe('minecraft install detection', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-detect-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null for a folder with nothing launchable in it', () => {
    expect(detectMinecraftLaunchable(tmpDir)).toBeNull()
  })

  it('returns null for a folder that does not exist at all', () => {
    expect(detectMinecraftLaunchable(path.join(tmpDir, 'nope'))).toBeNull()
  })

  it('detects a plain jar as launchMode "jar"', () => {
    fs.writeFileSync(path.join(tmpDir, 'server.jar'), '')
    expect(detectMinecraftLaunchable(tmpDir)).toEqual({ launchMode: 'jar', jarFileName: 'server.jar', scriptFileName: '' })
  })

  it('prefers a non-installer jar when multiple jars exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'fabric-installer.jar'), '')
    fs.writeFileSync(path.join(tmpDir, 'fabric-server-launch.jar'), '')
    expect(detectMinecraftLaunchable(tmpDir)).toEqual({
      launchMode: 'jar',
      jarFileName: 'fabric-server-launch.jar',
      scriptFileName: ''
    })
  })

  it('prefers a launch script over a jar (Forge signal)', () => {
    fs.writeFileSync(path.join(tmpDir, 'server.jar'), '')
    const scriptName = platform === 'win32' ? 'run.bat' : 'run.sh'
    fs.writeFileSync(path.join(tmpDir, scriptName), '')
    expect(detectMinecraftLaunchable(tmpDir)).toEqual({ launchMode: 'script', jarFileName: '', scriptFileName: scriptName })
  })

  it('does not look inside subfolders for a jar', () => {
    const libDir = path.join(tmpDir, 'libraries')
    fs.mkdirSync(libDir)
    fs.writeFileSync(path.join(libDir, 'some-dependency.jar'), '')
    expect(detectMinecraftLaunchable(tmpDir)).toBeNull()
  })

  it('reports a valid install once server.properties exists, even with nothing launchable', () => {
    expect(isValidMinecraftInstall(tmpDir)).toBe(false)
    fs.writeFileSync(path.join(tmpDir, 'server.properties'), '')
    expect(isValidMinecraftInstall(tmpDir)).toBe(true)
  })

  it('reports a valid install once eula.txt exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'eula.txt'), 'eula=false\n')
    expect(isValidMinecraftInstall(tmpDir)).toBe(true)
  })

  it('reports a valid install for a launchable-but-never-run folder (jar only, no properties/eula yet)', () => {
    fs.writeFileSync(path.join(tmpDir, 'server.jar'), '')
    expect(isValidMinecraftInstall(tmpDir)).toBe(true)
  })

  it('builds a best-effort profile from a detected jar', () => {
    fs.writeFileSync(path.join(tmpDir, 'server.jar'), '')
    const profile = detectMinecraftProfile(tmpDir)
    expect(profile.installDir).toBe(tmpDir)
    expect(profile.launchMode).toBe('jar')
    expect(profile.jarFileName).toBe('server.jar')
    expect(profile.name).toBe(path.basename(tmpDir))
    expect(profile.id).toBeTruthy()
  })

  it('falls back to launchMode "jar" with an empty jarFileName when nothing is detected', () => {
    const profile = detectMinecraftProfile(tmpDir)
    expect(profile.launchMode).toBe('jar')
    expect(profile.jarFileName).toBe('')
    expect(profile.scriptFileName).toBe('')
  })
})
