import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sendRconCommand } from '../src/main/lib/rcon'
import type { ServerProfile } from '../shared/types'

describe('sendRconCommand', () => {
  let tmpDir: string
  let installDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcon-test-'))
    installDir = path.join(tmpDir, 'install')
    const configDir = path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer')
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, 'GameUserSettings.ini'),
      '[ServerSettings]\r\nServerAdminPassword=hunter2\r\n'
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('resolves with a clean error instead of throwing an uncaught exception when the connection resets mid-authentication', async () => {
    // A real report: rcon-client's Rcon.connect() authenticates over the socket as part of
    // connecting. A reset during that exchange fires the socket's 'error' event - which
    // rcon-client re-emits on the Rcon instance's own EventEmitter - before Rcon.connect()'s
    // promise (and therefore a listener only attached after it resolves) exists. With no
    // listener at that moment, Node throws the 'error' event as an uncaught exception. A fake
    // server that accepts the connection and immediately resets it reproduces that exact
    // window - this only passes if sendRconCommand's own no-op 'error' listener is attached
    // before connect() runs, not after (see rcon.ts).
    const server = net.createServer((socket) => {
      // Resetting only once the auth packet actually arrives (rather than immediately on
      // connection) is what lands this in the specific vulnerable window: the client's own
      // TCP-connect-phase error handling has already resolved by then (rcon-client attaches
      // its permanent, re-emitting 'error' listener right after 'connect' fires, before
      // authenticating), so this exercises the post-connect, mid-authentication reset -
      // resetting immediately on connection would instead land in the connect-phase error
      // path, which was never the gap this test is for.
      socket.once('data', () => {
        if (socket.resetAndDestroy) socket.resetAndDestroy()
        else socket.destroy()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as net.AddressInfo).port

    const uncaught: unknown[] = []
    const onUncaught = (err: unknown): void => {
      uncaught.push(err)
    }
    process.on('uncaughtException', onUncaught)

    try {
      const profile = { id: 'rcon-reset-test', installDir, rconPort: port } as ServerProfile
      const result = await sendRconCommand(profile, 'ListPlayers')
      expect(result.ok).toBe(false)
    } finally {
      process.off('uncaughtException', onUncaught)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    expect(uncaught).toEqual([])
  })

  it('resolves with a clean error when nothing is listening on the RCON port at all', async () => {
    const profile = { id: 'rcon-refused-test', installDir, rconPort: 1 } as ServerProfile
    const result = await sendRconCommand(profile, 'ListPlayers')
    expect(result.ok).toBe(false)
  })

  it('returns an explanatory error when the profile has no ServerAdminPassword set', async () => {
    const bareInstallDir = path.join(tmpDir, 'bare-install')
    fs.mkdirSync(bareInstallDir, { recursive: true })
    const profile = { id: 'rcon-no-password', installDir: bareInstallDir, rconPort: 27020 } as ServerProfile

    const result = await sendRconCommand(profile, 'ListPlayers')

    expect(result).toEqual({
      ok: false,
      error: "No ServerAdminPassword set in this server's GameUserSettings.ini"
    })
  })
})
