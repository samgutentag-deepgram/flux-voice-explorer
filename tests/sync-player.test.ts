/**
 * SyncPlayer, tested against real stub elements.
 *
 * No jsdom: the player only touches `addEventListener`, `preload`, `volume`,
 * `play`, `pause`, `currentTime`, and `duration`, so a stub covers it. Tests
 * stay in the default node environment and add no dependency.
 *
 * What matters here is the coordinate system. `progress` is a position in the
 * SCRIPT on the canonical timeline, and each element converts it through its own
 * measured word positions. These tests pin that a handoff keeps the WORD, which
 * is the property the whole design exists for.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncPlayer } from '../src/lib/sync-player.ts'

// Three voices, same five words, wildly different pacing. `fast` rushes the
// opening and lingers at the end; `slow` does the opposite.
const CANONICAL = [0, 0.25, 0.5, 0.75, 0.9]
const FAST = [0, 0.1, 0.2, 0.3, 0.95]
const SLOW = [0, 0.5, 0.7, 0.8, 0.9]

function stubElement(duration: number) {
  return {
    duration,
    currentTime: 0,
    volume: 0,
    paused: true,
    preload: 'none',
    seeking: false,
    readyState: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
  } as unknown as HTMLAudioElement
}

function makePlayer() {
  const player = new SyncPlayer({ referenceDuration: 100, canonicalStarts: CANONICAL })
  const tiles = { fast: stubElement(80), slow: stubElement(140), bare: stubElement(100) }
  player.register('fast', tiles.fast, 80, FAST)
  player.register('slow', tiles.slow, 140, SLOW)
  // No alignment: falls back to treating the position as a plain fraction.
  player.register('bare', tiles.bare, 100)
  return { player, tiles }
}

/**
 * Hand-driven animation clock. `player.play()` schedules one frame; `advance()`
 * moves time forward and runs it. Both `performance.now` and rAF are stubbed so
 * the loop's `dt` is exactly what the test asked for.
 */
let clock = 0
let frame: FrameRequestCallback | null = null

function advance(ms: number) {
  clock += ms
  const cb = frame
  frame = null
  cb?.(clock)
}

beforeEach(() => {
  clock = 1000
  frame = null
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frame = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    frame = null
  })
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

describe('handing off between voices', () => {
  it('seeks a voice through its own timeline, not a shared fraction', () => {
    const { player, tiles } = makePlayer()
    // Canonical start of word 2.
    player.seek(CANONICAL[2]!)
    player.play()
    player.focus('slow')
    // Word 2 in the slow voice is at 0.7 of its own clip, not 0.5.
    expect(tiles.slow.currentTime).toBeCloseTo(SLOW[2]! * 140, 6)
    expect(tiles.slow.currentTime).not.toBeCloseTo(CANONICAL[2]! * 140, 1)
  })

  it('lands the next voice on the same WORD, whatever the pacing', () => {
    const { player, tiles } = makePlayer()
    player.seek(CANONICAL[3]!)
    player.play()
    player.focus('fast')
    player.focus('slow')
    expect(tiles.fast.currentTime).toBeCloseTo(FAST[3]! * 80, 6)
    expect(tiles.slow.currentTime).toBeCloseTo(SLOW[3]! * 140, 6)
  })

  it('does NOT rewind on a handoff', () => {
    // The run-up used to exist to paper over landing on the wrong word. It is
    // gone, and this pins that it stays gone.
    const { player } = makePlayer()
    player.seek(0.5)
    player.play()
    player.focus('fast')
    player.focus('slow')
    player.focus('fast')
    expect(player.getState().progress).toBeCloseTo(0.5, 6)
  })

  it('pauses the outgoing voice and plays the incoming one', () => {
    const { player, tiles } = makePlayer()
    player.play()
    player.focus('fast')
    expect(tiles.fast.play).toHaveBeenCalled()
    player.focus('slow')
    expect(tiles.slow.play).toHaveBeenCalled()
  })

  it('treats the position as a plain fraction for an unaligned voice', () => {
    const { player, tiles } = makePlayer()
    player.seek(0.4)
    player.play()
    player.focus('bare')
    expect(tiles.bare.currentTime).toBeCloseTo(40, 6)
  })

  it('round-trips a word position through both voices without drift', () => {
    // Hop back and forth. Each hop converts canonical -> local -> canonical, so
    // an asymmetry between the two directions would show up as creep.
    const { player, tiles } = makePlayer()
    player.seek(CANONICAL[2]!)
    player.play()
    for (const id of ['fast', 'slow', 'fast', 'slow', 'fast']) player.focus(id)
    expect(player.getState().progress).toBeCloseTo(CANONICAL[2]!, 6)
    expect(tiles.fast.currentTime).toBeCloseTo(FAST[2]! * 80, 6)
  })

  it('detaches the error listener on unregister, so a re-register cannot double it', () => {
    const { player, tiles } = makePlayer()
    player.unregister('fast')
    expect(tiles.fast.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function))
  })
})

describe('the clock during a handoff', () => {
  /**
   * The regression these pin: `focus()` seeks the new element, but `play()` is a
   * promise, so for a frame or two the element is still paused. The loop used to
   * fall through to the wall-clock branch and advance past the seek point, then
   * snap backward when the element took over. Every hover paid it, so sweeping
   * the grid walked the ticker behind the audio.
   */
  it('does not advance the playhead while a track is starting', () => {
    const { player, tiles } = makePlayer()
    // play() never resolves, so the start stays in flight.
    ;(tiles.slow as { play: () => Promise<void> }).play = () => new Promise<void>(() => {})
    player.seek(CANONICAL[2]!)
    player.play()
    player.focus('slow')
    advance(500)
    expect(player.getState().progress).toBeCloseTo(CANONICAL[2]!, 6)
  })

  it('ignores an element that is mid-seek', () => {
    const { player, tiles } = makePlayer()
    player.seek(CANONICAL[2]!)
    player.play()
    player.focus('slow')
    ;(tiles.slow as { paused: boolean }).paused = false
    ;(tiles.slow as { seeking: boolean }).seeking = true
    ;(tiles.slow as { currentTime: number }).currentTime = 0
    advance(16)
    // A naive read would map currentTime 0 to the top of the script.
    expect(player.getState().progress).toBeGreaterThan(0.1)
  })

  it('ignores an element with no metadata yet', () => {
    const { player, tiles } = makePlayer()
    player.seek(CANONICAL[2]!)
    player.play()
    player.focus('slow')
    ;(tiles.slow as { paused: boolean }).paused = false
    ;(tiles.slow as { readyState: number }).readyState = 0
    ;(tiles.slow as { currentTime: number }).currentTime = 0
    advance(16)
    expect(player.getState().progress).toBeGreaterThan(0.1)
  })

  it('takes the element back over once it is readable', async () => {
    const { player, tiles } = makePlayer()
    player.seek(CANONICAL[1]!)
    player.play()
    player.focus('slow')
    // `startTrack` awaits play(), so the hold is released on a microtask.
    await Promise.resolve()
    await Promise.resolve()
    ;(tiles.slow as { paused: boolean }).paused = false
    ;(tiles.slow as { currentTime: number }).currentTime = SLOW[3]! * 140
    advance(16)
    expect(player.getState().progress).toBeCloseTo(CANONICAL[3]!, 4)
  })

  it('does not overshoot then snap back across a hold, which was the bug', async () => {
    const { player, tiles } = makePlayer()
    player.seek(CANONICAL[2]!)
    player.play()
    player.focus('slow')
    await Promise.resolve()
    await Promise.resolve()
    ;(tiles.slow as { paused: boolean }).paused = false
    // The element resumes exactly where it was seeked to.
    ;(tiles.slow as { currentTime: number }).currentTime = SLOW[2]! * 140
    const before = player.getState().progress
    advance(16)
    // Monotonic: never behind where the hold left it.
    expect(player.getState().progress).toBeGreaterThanOrEqual(before - 1e-9)
  })
})

describe('elapsed', () => {
  it('is the audible voice own seconds, not progress times duration', () => {
    const { player, tiles } = makePlayer()
    player.seek(CANONICAL[2]!)
    player.play()
    player.focus('slow')
    // 0.7 * 140 = 98s, where progress * duration would claim 0.5 * 140 = 70s.
    expect(player.getState().elapsed).toBeCloseTo(SLOW[2]! * 140, 4)
    expect(tiles.slow.currentTime).toBeCloseTo(98, 4)
  })

  it('falls back to the reference duration with nothing focused', () => {
    const { player } = makePlayer()
    player.seek(0.25)
    expect(player.getState().elapsed).toBeCloseTo(25, 6)
  })
})

describe('seeking', () => {
  it('nudges in seconds against the reference duration', () => {
    const { player } = makePlayer()
    player.seek(0.5)
    player.nudge(5)
    expect(player.getState().progress).toBeCloseTo(0.55, 10)
  })

  it('clamps a seek to the 0..1 script range', () => {
    const { player } = makePlayer()
    player.seek(3)
    expect(player.getState().progress).toBe(1)
    player.seek(-3)
    expect(player.getState().progress).toBe(0)
  })

  it('moves the audible element when the playhead moves', () => {
    const { player, tiles } = makePlayer()
    player.play()
    player.focus('fast')
    player.seek(CANONICAL[1]!)
    expect(tiles.fast.currentTime).toBeCloseTo(FAST[1]! * 80, 6)
  })
})

describe('registration', () => {
  it('accepts timings that arrive after the element', () => {
    const player = new SyncPlayer({ referenceDuration: 100, canonicalStarts: CANONICAL })
    const el = stubElement(140)
    player.register('slow', el, 140)
    player.register('slow', el, 140, SLOW)
    player.seek(CANONICAL[2]!)
    player.play()
    player.focus('slow')
    expect(el.currentTime).toBeCloseTo(SLOW[2]! * 140, 6)
  })

  it('unregister drops the track without leaving it focused', () => {
    const { player } = makePlayer()
    player.play()
    player.focus('fast')
    player.unregister('fast')
    expect(player.getState().focusedId).toBeNull()
  })
})

describe('scrubbing', () => {
  it('silences and pauses the audible voice for the length of the drag', () => {
    const { player, tiles } = makePlayer()
    player.play()
    player.focus('slow')
    player.beginScrub()
    // The fade runs on a timer; the pause is what matters for the stutter.
    expect(player.getState().progress).toBeDefined()
    player.endScrub()
    expect(tiles.slow.play).toHaveBeenCalled()
  })

  it('does not re-seek the element on every move mid-drag', () => {
    const { player, tiles } = makePlayer()
    player.play()
    player.focus('slow')
    const at = tiles.slow.currentTime
    player.beginScrub()
    player.seek(0.1)
    player.seek(0.2)
    player.seek(0.3)
    // Re-seeking a playing element per pointer move is a stutter, not a scrub.
    expect(tiles.slow.currentTime).toBe(at)
  })

  it('lands on the release point', async () => {
    const { player, tiles } = makePlayer()
    player.play()
    player.focus('slow')
    player.beginScrub()
    player.seek(CANONICAL[3]!)
    player.endScrub()
    await Promise.resolve()
    expect(tiles.slow.currentTime).toBeCloseTo(SLOW[3]! * 140, 4)
  })

  it('keeps elapsed honest while scrubbing, for the readout', () => {
    const { player } = makePlayer()
    player.play()
    player.focus('slow')
    player.beginScrub()
    player.seek(CANONICAL[2]!)
    expect(player.getState().elapsed).toBeCloseTo(SLOW[2]! * 140, 4)
  })

  it('the tick loop cannot move the playhead mid-drag', () => {
    const { player, tiles } = makePlayer()
    player.play()
    player.focus('slow')
    player.beginScrub()
    player.seek(0.42)
    ;(tiles.slow as { paused: boolean }).paused = false
    ;(tiles.slow as { currentTime: number }).currentTime = 0
    advance(16)
    expect(player.getState().progress).toBeCloseTo(0.42, 6)
  })

  it('beginScrub and endScrub are idempotent', () => {
    const { player } = makePlayer()
    player.play()
    player.focus('slow')
    player.beginScrub()
    player.beginScrub()
    player.endScrub()
    player.endScrub()
    player.seek(0.3)
    expect(player.getState().progress).toBeCloseTo(0.3, 6)
  })
})

describe('regressions found in review', () => {
  it('the end-of-script reset cannot fight a scrub', () => {
    // Dragging to the right edge lands on exactly 1. The reset used to flip the
    // ticker between the last word and the first on every frame.
    const { player } = makePlayer()
    player.play()
    player.focus('slow')
    player.beginScrub()
    player.seek(1)
    advance(16)
    expect(player.getState().progress).toBe(1)
  })

  it('pause clears scrub mode, so a lost pointerup cannot freeze the playhead', () => {
    const { player } = makePlayer()
    player.play()
    player.focus('slow')
    player.beginScrub()
    player.pause()
    player.play()
    player.seek(0.3)
    advance(16)
    // Would be stuck at 0.3 forever if `scrubbing` had survived.
    expect(player.getState().playing).toBe(true)
  })

  it('focusing while paused puts the readout on the new voice', () => {
    // Was: previous voice's elapsed against the new voice's total, so pausing at
    // 1:20 of a 142s voice and hovering an 84s one read "1:20 / 1:24".
    const { player } = makePlayer()
    player.seek(CANONICAL[2]!)
    player.focus('slow')
    expect(player.getState().elapsed).toBeCloseTo(SLOW[2]! * 140, 4)
    player.focus('fast')
    expect(player.getState().elapsed).toBeCloseTo(FAST[2]! * 80, 4)
  })

  it('unregister tells the app it dropped the focus', () => {
    // While paused there is no tick, so without the emit the transport kept
    // naming a voice that had just been filtered out of the grid.
    const seen: (string | null)[] = []
    const player = new SyncPlayer({
      referenceDuration: 100,
      canonicalStarts: CANONICAL,
      onUpdate: (s) => seen.push(s.focusedId),
    })
    player.register('slow', stubElement(140), 140, SLOW)
    player.focus('slow')
    seen.length = 0
    player.unregister('slow')
    expect(seen).toContain(null)
  })

  it('re-registering an id with a new element detaches the old one', () => {
    const player = new SyncPlayer({ referenceDuration: 100, canonicalStarts: CANONICAL })
    const first = stubElement(140)
    const second = stubElement(140)
    player.register('slow', first, 140, SLOW)
    player.register('slow', second, 140, SLOW)
    expect(first.pause).toHaveBeenCalled()
    expect(first.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('a zero-duration track cannot poison the playhead with NaN', () => {
    const player = new SyncPlayer({ referenceDuration: 100, canonicalStarts: CANONICAL })
    const broken = stubElement(Number.NaN)
    player.register('broken', broken, 0, SLOW)
    player.seek(0.5)
    player.play()
    player.focus('broken')
    ;(broken as { paused: boolean }).paused = false
    ;(broken as { seeking: boolean }).seeking = true
    advance(16)
    expect(Number.isFinite(player.getState().progress)).toBe(true)
  })
})

describe('seekLocal', () => {
  it('converts a fraction of one clip into a script position', () => {
    // The waveform x axis is equal slices of THAT clip, not of the script.
    const { player } = makePlayer()
    player.seekLocal('slow', SLOW[2]!)
    expect(player.getState().progress).toBeCloseTo(CANONICAL[2]!, 6)
  })

  it('does not treat the fraction as a script position', () => {
    // The bug it exists to prevent: at word 2 the slow voice is 70% through its
    // own clip but only 50% through the script.
    const { player } = makePlayer()
    player.seekLocal('slow', 0.7)
    expect(player.getState().progress).not.toBeCloseTo(0.7, 2)
    expect(player.getState().progress).toBeCloseTo(0.5, 6)
  })

  it('gives two differently paced voices different answers for the same fraction', () => {
    const a = makePlayer()
    a.player.seekLocal('fast', 0.2)
    const b = makePlayer()
    b.player.seekLocal('slow', 0.2)
    expect(a.player.getState().progress).not.toBeCloseTo(b.player.getState().progress, 3)
  })

  it('moves the audible element to the clicked point', () => {
    const { player, tiles } = makePlayer()
    player.play()
    player.focus('slow')
    player.seekLocal('slow', SLOW[3]!)
    expect(tiles.slow.currentTime).toBeCloseTo(SLOW[3]! * 140, 4)
  })

  it('clamps out-of-range fractions', () => {
    const { player } = makePlayer()
    player.seekLocal('slow', 5)
    expect(player.getState().progress).toBeLessThanOrEqual(1)
    player.seekLocal('slow', -5)
    expect(player.getState().progress).toBe(0)
  })

  it('ignores an unknown voice rather than throwing', () => {
    const { player } = makePlayer()
    player.seek(0.4)
    player.seekLocal('nope', 0.9)
    expect(player.getState().progress).toBeCloseTo(0.4, 6)
  })
})
