import { describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { watchForStartupMarker } from '../src/main/lib/serverProcess'

describe('watchForStartupMarker', () => {
  it('fires onReady once the marker line appears', () => {
    const stream = new PassThrough()
    const onReady = vi.fn()
    watchForStartupMarker(stream, 'READY_MARKER', onReady)

    stream.write('some other log line\n')
    expect(onReady).not.toHaveBeenCalled()

    stream.write('prefix READY_MARKER suffix\n')
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('detects the marker even when split across chunk boundaries', () => {
    const stream = new PassThrough()
    const onReady = vi.fn()
    watchForStartupMarker(stream, 'READY_MARKER', onReady)

    stream.write('...READY_')
    expect(onReady).not.toHaveBeenCalled()
    stream.write('MARKER...')
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('only fires once even if more data arrives afterwards', () => {
    const stream = new PassThrough()
    const onReady = vi.fn()
    watchForStartupMarker(stream, 'READY_MARKER', onReady)

    stream.write('READY_MARKER')
    stream.write('more output after READY_MARKER again')
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('never fires when the marker never appears', () => {
    const stream = new PassThrough()
    const onReady = vi.fn()
    watchForStartupMarker(stream, 'READY_MARKER', onReady)

    stream.write('loading...\n')
    stream.write('still loading...\n')
    expect(onReady).not.toHaveBeenCalled()
  })
})
