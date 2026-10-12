import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readServerProperties,
  getMinecraftServerPort,
  getMinecraftRconConfig,
  isEulaAccepted,
  writeUserJvmArgs,
  upsertServerPropertiesKeys
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

describe('writeUserJvmArgs', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-jvmargs-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes one argument per line', () => {
    writeUserJvmArgs(tmpDir, ['-Xms1024M', '-Xmx4096M'])
    const content = fs.readFileSync(path.join(tmpDir, 'user_jvm_args.txt'), 'utf-8')
    expect(content).toBe('-Xms1024M\n-Xmx4096M\n')
  })

  it('overwrites whatever was there before (e.g. from a previous start with different memory)', () => {
    writeUserJvmArgs(tmpDir, ['-Xms1024M', '-Xmx4096M'])
    writeUserJvmArgs(tmpDir, ['-Xms2048M', '-Xmx8192M'])
    const content = fs.readFileSync(path.join(tmpDir, 'user_jvm_args.txt'), 'utf-8')
    expect(content).toBe('-Xms2048M\n-Xmx8192M\n')
  })
})

describe('upsertServerPropertiesKeys', () => {
  let tmpDir: string
  let filePath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-upsert-test-'))
    filePath = path.join(tmpDir, 'server.properties')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the file when none exists yet', () => {
    upsertServerPropertiesKeys(tmpDir, { 'server-port': '25566' })
    expect(readServerProperties(tmpDir)).toEqual({ 'server-port': '25566' })
  })

  it('replaces an existing key in place, keeping every other line untouched', () => {
    fs.writeFileSync(filePath, ['#Minecraft server properties', 'server-port=25565', 'motd=Hello'].join('\n'))
    upsertServerPropertiesKeys(tmpDir, { 'server-port': '30000' })
    const raw = fs.readFileSync(filePath, 'utf-8')
    expect(raw).toBe(['#Minecraft server properties', 'server-port=30000', 'motd=Hello'].join('\n'))
  })

  it('appends a key that has no existing line, without disturbing the rest', () => {
    fs.writeFileSync(filePath, ['motd=Hello'].join('\n'))
    upsertServerPropertiesKeys(tmpDir, { 'server-port': '30000' })
    expect(readServerProperties(tmpDir)).toEqual({ motd: 'Hello', 'server-port': '30000' })
  })

  it('preserves comments and a key this app does not know about', () => {
    fs.writeFileSync(filePath, ['#A comment', 'some-plugin-key=custom-value', 'motd=Hello'].join('\n'))
    upsertServerPropertiesKeys(tmpDir, { motd: 'Updated' })
    const raw = fs.readFileSync(filePath, 'utf-8')
    expect(raw).toBe(['#A comment', 'some-plugin-key=custom-value', 'motd=Updated'].join('\n'))
  })

  it('updates multiple keys in one call', () => {
    fs.writeFileSync(filePath, ['server-port=25565', 'motd=Hello', 'pvp=true'].join('\n'))
    upsertServerPropertiesKeys(tmpDir, { 'server-port': '30000', pvp: 'false' })
    expect(readServerProperties(tmpDir)).toEqual({ 'server-port': '30000', motd: 'Hello', pvp: 'false' })
  })
})
