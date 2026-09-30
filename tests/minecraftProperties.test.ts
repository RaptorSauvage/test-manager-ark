import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readServerProperties,
  getMinecraftServerPort,
  getMinecraftRconConfig,
  isEulaAccepted
} from '../src/main/lib/minecraftProperties'

describe('minecraft properties reading', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-properties-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns an empty object when server.properties does not exist', () => {
    expect(readServerProperties(tmpDir)).toEqual({})
  })

  it('parses key=value pairs, skipping comments and blank lines', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'server.properties'),
      ['#Minecraft server properties', '!Some other comment style', '', 'server-port=25566', 'motd=Hello World'].join('\n')
    )
    expect(readServerProperties(tmpDir)).toEqual({ 'server-port': '25566', motd: 'Hello World' })
  })

  it('does not treat a semicolon as a comment (unlike ini files)', () => {
    fs.writeFileSync(path.join(tmpDir, 'server.properties'), 'motd=Welcome; enjoy your stay')
    expect(readServerProperties(tmpDir)).toEqual({ motd: 'Welcome; enjoy your stay' })
  })

  it('falls back to the documented default port when unset', () => {
    expect(getMinecraftServerPort(tmpDir)).toBe(25565)
    fs.writeFileSync(path.join(tmpDir, 'server.properties'), 'server-port=30000')
    expect(getMinecraftServerPort(tmpDir)).toBe(30000)
  })

  it('reads RCON config, defaulting to disabled with the documented default port', () => {
    expect(getMinecraftRconConfig(tmpDir)).toEqual({ enabled: false, port: 25575, password: '' })
    fs.writeFileSync(
      path.join(tmpDir, 'server.properties'),
      ['enable-rcon=true', 'rcon.port=25576', 'rcon.password=hunter2'].join('\n')
    )
    expect(getMinecraftRconConfig(tmpDir)).toEqual({ enabled: true, port: 25576, password: 'hunter2' })
  })

  it('treats any casing of "true" for enable-rcon as enabled', () => {
    fs.writeFileSync(path.join(tmpDir, 'server.properties'), 'enable-rcon=TRUE')
    expect(getMinecraftRconConfig(tmpDir).enabled).toBe(true)
  })

  it('reports the EULA as not accepted when eula.txt is missing', () => {
    expect(isEulaAccepted(tmpDir)).toBe(false)
  })

  it('reports the EULA as not accepted when eula=false', () => {
    fs.writeFileSync(path.join(tmpDir, 'eula.txt'), '#comment\neula=false\n')
    expect(isEulaAccepted(tmpDir)).toBe(false)
  })

  it('reports the EULA as accepted when eula=true', () => {
    fs.writeFileSync(path.join(tmpDir, 'eula.txt'), '#comment\neula=true\n')
    expect(isEulaAccepted(tmpDir)).toBe(true)
  })
})
