import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { ServerProfile } from '../shared/types'

const scheduledCallbacks = new Map<string, () => void>()
let scheduleCallIndex = 0

vi.mock('node-cron', () => ({
  default: {
    validate: vi.fn((expr: string) => /^\d+ \d+ \* \* [\d,]+$/.test(expr)),
    schedule: vi.fn((_expr: string, callback: () => void) => {
      scheduledCallbacks.set(`task-${scheduleCallIndex++}`, callback)
      return { stop: vi.fn() }
    })
  }
}))
vi.mock('../src/main/lib/serverProcess', () => ({
  isRunning: vi.fn(() => true),
  startServer: vi.fn(),
  stopServer: vi.fn(),
  setUpdating: vi.fn()
}))
vi.mock('../src/main/lib/monitor', () => ({ startMonitoring: vi.fn() }))
vi.mock('../src/main/lib/steamcmd', () => ({ updateServer: vi.fn(), getUpdateLogPath: vi.fn(() => '/tmp/log') }))
vi.mock('../src/main/lib/rcon', () => ({ sendRconCommand: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('../src/main/store', () => ({ getSettings: vi.fn(() => ({ steamCmdPath: '' })), getProfile: vi.fn() }))
vi.mock('../src/main/lib/managerLog', () => ({ logManagerEvent: vi.fn(), newTaskId: vi.fn(() => 'task-id') }))
vi.mock('node:fs', () => ({ default: { mkdirSync: vi.fn(), appendFileSync: vi.fn() } }))

import cron from 'node-cron'
import { applyScheduledRconCommands, clearScheduledRconCommands } from '../src/main/lib/scheduledActions'
import { isRunning as mockIsRunning } from '../src/main/lib/serverProcess'
import { sendRconCommand as mockSendRconCommand } from '../src/main/lib/rcon'

function makeEntry(overrides: Partial<ServerProfile['scheduledRconCommands'][number]> = {}): ServerProfile['scheduledRconCommands'][number] {
  return { id: 'entry-1', label: 'Test', command: 'SaveWorld', time: '04:00', days: [1, 2], enabled: true, ...overrides }
}

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return { id: 'rcon-sched-test', name: 'RconSchedTest', installDir: '/tmp/ark', scheduledRconCommands: [], ...overrides } as ServerProfile
}

describe('applyScheduledRconCommands/clearScheduledRconCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockIsRunning).mockReturnValue(true)
    scheduledCallbacks.clear()
    scheduleCallIndex = 0
  })

  it('schedules one cron task per enabled entry with a non-empty command', () => {
    const profile = makeProfile({ scheduledRconCommands: [makeEntry({ id: 'a' }), makeEntry({ id: 'b', command: 'ServerChat hi' })] })
    applyScheduledRconCommands(profile)
    expect(cron.schedule).toHaveBeenCalledTimes(2)
  })

  it('skips disabled entries and entries with an empty/blank command', () => {
    const profile = makeProfile({
      scheduledRconCommands: [makeEntry({ id: 'off', enabled: false }), makeEntry({ id: 'blank', command: '   ' })]
    })
    applyScheduledRconCommands(profile)
    expect(cron.schedule).not.toHaveBeenCalled()
  })

  it('skips an entry with no days selected (invalid cron)', () => {
    const profile = makeProfile({ scheduledRconCommands: [makeEntry({ days: [] })] })
    applyScheduledRconCommands(profile)
    expect(cron.schedule).not.toHaveBeenCalled()
  })

  it("sends the entry's exact command via RCON when its schedule fires and the server is running", async () => {
    const profile = makeProfile({ scheduledRconCommands: [makeEntry({ command: 'ServerChat Reminder' })] })
    applyScheduledRconCommands(profile)

    scheduledCallbacks.get('task-0')?.()
    await vi.waitFor(() => expect(mockSendRconCommand).toHaveBeenCalledWith(profile, 'ServerChat Reminder'))
  })

  it('does not send anything when the server is not running at fire time', async () => {
    vi.mocked(mockIsRunning).mockReturnValue(false)
    const profile = makeProfile({ scheduledRconCommands: [makeEntry()] })
    applyScheduledRconCommands(profile)

    scheduledCallbacks.get('task-0')?.()
    expect(mockSendRconCommand).not.toHaveBeenCalled()
  })

  it("clearing one profile's tasks does not stop another profile's", () => {
    const profileA = makeProfile({ id: 'profile-a', scheduledRconCommands: [makeEntry({ id: 'a1' })] })
    const profileB = makeProfile({ id: 'profile-b', scheduledRconCommands: [makeEntry({ id: 'b1' })] })
    applyScheduledRconCommands(profileA)
    applyScheduledRconCommands(profileB)

    clearScheduledRconCommands('profile-a')

    // Re-applying profile B fresh still only schedules its own single entry - if clearing
    // "profile-a" had accidentally also torn down profile-b's task map entry, re-applying it
    // would be a no-op difference we can't observe directly, so instead assert indirectly:
    // profile-b's originally scheduled callback is still the one registered (never stopped).
    const stopFn = vi.mocked(cron.schedule).mock.results[1].value.stop
    expect(stopFn).not.toHaveBeenCalled()
  })
})
