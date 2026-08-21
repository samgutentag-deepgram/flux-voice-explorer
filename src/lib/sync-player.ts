/**
 * The shared-playhead engine.
 *
 * The whole interaction is "one playhead, many voices". You are never really
 * scrubbing an audio file, you are scrubbing a position in the SCRIPT, and
 * whichever tile you hover renders that position out loud.
 *
 * `progress` is therefore a position in the script on the CANONICAL timeline
 * (0..1, the mean of every aligned voice), and each element converts it through
 * its own measured word positions. Hover a new tile mid-sentence and you land on
 * the same WORD.
 *
 * The obvious cheaper version -- `progress * itsDuration` -- was what this did
 * first, and it is wrong in a way you can hear. It assumes two voices spend
 * their time through the script the same way, only faster or slower. They do
 * not: each places its own pauses, so at 40% Bree is several words from where
 * Drew is, and swapping between them drops you elsewhere in the sentence. The
 * per-voice mapping in word-timeline.ts is what removes that.
 *
 * Two consequences worth knowing before you change this:
 *
 * 1. While a voice is audible it OWNS the clock. `progress` is read from that
 *    element's `currentTime`, not from a wall-clock timer, so the transport bar
 *    cannot lie about where you are. A free-running timer would drift against
 *    the audible element by the ratio of its duration to the reference.
 * 2. A handoff does not rewind. It used to give the incoming voice a few words
 *    of run-up, which existed to paper over the old fraction-of-duration
 *    mapping: you were landing on the wrong word, so a run-up gave you context
 *    to re-find your place. With the per-voice mapping you land on the word you
 *    were already on, and any rewind is just an audible stutter.
 * 3. Only the focused element plays. Keeping all ~36 playing and muted was the
 *    first design; it buys nothing. A muted element advances at rate 1 while
 *    the normalized playhead advances at 1/reference, so by two minutes in it
 *    is up to 15 seconds off content-wise and needs the same seek on focus that
 *    a paused element needs. Same seek, 36x the decoders.
 */

import { fromCanonical, toCanonical } from './word-timeline.ts'

export type SyncPlayerOptions = {
  /** Seconds. The pace the playhead runs at when nothing is audible. */
  referenceDuration: number
  /**
   * Canonical normalized start position per script word: the mean across every
   * aligned voice. This is the coordinate system `progress` lives in, and the
   * reference every per-voice timeline maps through.
   */
  canonicalStarts?: number[]
  onUpdate?: (state: SyncState) => void
}

export type SyncState = {
  /** 0..1 through the script, on the canonical timeline. */
  progress: number
  playing: boolean
  focusedId: string | null
  /**
   * Seconds into the audible clip, for the readout. Not `progress * duration`:
   * that is only true if the voice paces like the canonical average.
   */
  elapsed: number
  /**
   * 0..1 through the AUDIBLE CLIP, as distinct from `progress` which is through
   * the script. Anything drawn over clip-time geometry needs this one: a tile's
   * waveform x axis is uniform slices of that clip's duration, so filling it to
   * `progress` puts the marker several words from the audio. Zero when nothing
   * is audible.
   */
  localProgress: number
  /** Voices whose clip failed to load, by id. */
  failed: string[]
}

/** Seconds of drift tolerated before we bother seeking. */
const SEEK_EPSILON = 0.2
const FADE_STEPS = 6
/** Total duck/crossfade time. Short enough to feel instant on a hover. */
const FADE_MS = 90

type Track = {
  id: string
  el: HTMLAudioElement
  /** Manifest duration, used until the element reports its own. */
  declared: number
  /** This voice's own measured word positions, on its own 0..1 scale. */
  starts: number[]
  /** Kept so unregister can detach them. */
  onError: () => void
  onMeta: () => void
}

export class SyncPlayer {
  private tracks = new Map<string, Track>()
  /**
   * Rebuilt only when a clip fails, so getState() does not spread a Set 60
   * times a second for a list that is empty in the normal case.
   */
  private failedList: string[] = []
  private opts: Required<Omit<SyncPlayerOptions, 'onUpdate'>> & Pick<SyncPlayerOptions, 'onUpdate'>
  private progress = 0
  private playing = false
  private focusedId: string | null = null
  private failed = new Set<string>()
  private raf: number | null = null
  private fadeTimers = new Map<string, ReturnType<typeof setInterval>>()
  private lastTick = 0
  /**
   * Seconds into the audible clip. Kept as a field rather than derived in
   * getState(): the tick loop already has `currentTime` in hand, and mapping
   * progress back through the voice's timeline to recover it is a binary search
   * to recompute the number we started from.
   */
  private elapsed = 0
  /**
   * Number of `startTrack` calls in flight. While one is, the clock is HELD:
   * neither source is trustworthy.
   *
   * This is what kept the ticker drifting behind the audio. `focus()` sets
   * `focusedId` and seeks the new element, but `el.play()` is a promise, so for
   * a frame or two `el.paused` is still true and the loop fell through to the
   * wall-clock branch -- advancing `progress` past the point the element was
   * just seeked to. When play() resolved, the element's own time won and the
   * playhead snapped BACKWARD by that overshoot. Every hover paid it, so
   * sweeping the grid walked the ticker steadily behind. Audio never showed it,
   * because audio just plays on from wherever it was seeked.
   */
  private starting = 0
  /** True for the length of a drag on the ticker. See beginScrub. */
  private scrubbing = false

  constructor(options: SyncPlayerOptions) {
    this.opts = {
      referenceDuration: Math.max(options.referenceDuration, 1),
      canonicalStarts: options.canonicalStarts ?? [],
      onUpdate: options.onUpdate,
    }
  }

  /** Swap in the canonical timeline once the alignment file has loaded. */
  setCanonicalStarts(starts: number[]): void {
    this.opts.canonicalStarts = starts
  }

  /** Register a tile's <audio>. Idempotent, so React refs can call it freely. */
  register(id: string, el: HTMLAudioElement, declaredDuration: number, starts: number[] = []): void {
    const existing = this.tracks.get(id)
    if (existing?.el === el) {
      // Timings can land after the element does; take them without re-binding.
      existing.starts = starts
      return
    }
    if (existing) {
      // Same id, different element. Detach the old one rather than leaving it
      // playing with live listeners the map no longer points at.
      existing.el.pause()
      existing.el.removeEventListener('error', existing.onError)
      existing.el.removeEventListener('loadedmetadata', existing.onMeta)
    }
    el.preload = 'metadata'
    el.volume = 0
    // Held so unregister can detach it. Without that, a tile that re-registers
    // stacks a second listener on the same element.
    const onError = () => {
      this.failed.add(id)
      this.failedList = [...this.failed]
      this.emit()
    }
    el.addEventListener('error', onError)
    // A seek before metadata throws, which would leave a focused element at 0
    // and yank the playhead to the top of the script. Re-align when it can.
    const onMeta = () => {
      const track = this.tracks.get(id)
      if (track && this.focusedId === id) this.align(track, true)
    }
    el.addEventListener('loadedmetadata', onMeta)
    this.tracks.set(id, { id, el, declared: declaredDuration, starts, onError, onMeta })
  }

  /** Update a track's timeline without tearing down its element. */
  setTrackStarts(id: string, starts: number[]): void {
    const track = this.tracks.get(id)
    if (track) track.starts = starts
  }

  unregister(id: string): void {
    const track = this.tracks.get(id)
    if (!track) return
    this.clearFade(id)
    track.el.pause()
    track.el.removeEventListener('error', track.onError)
    track.el.removeEventListener('loadedmetadata', track.onMeta)
    this.tracks.delete(id)
    if (this.focusedId === id) {
      this.focusedId = null
      this.emit()
    }
  }

  getState(): SyncState {
    const focused = this.focusedId ? this.tracks.get(this.focusedId) : null
    return {
      progress: this.progress,
      playing: this.playing,
      focusedId: this.focusedId,
      elapsed: focused ? this.elapsed : this.progress * this.opts.referenceDuration,
      localProgress: focused ? this.localPosition(focused, this.progress) : 0,
      failed: this.failedList,
    }
  }

  /**
   * Must be called from a user gesture. Browsers refuse `play()` otherwise, and
   * the refusal is a rejected promise rather than an exception, which is why
   * every play() below is caught.
   */
  play(): void {
    if (this.playing) return
    this.playing = true
    this.lastTick = performance.now()
    if (this.focusedId) void this.startTrack(this.focusedId)
    this.loop()
    this.emit()
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    this.scrubbing = false
    for (const track of this.tracks.values()) track.el.pause()
    this.stopLoop()
    this.emit()
  }

  /**
   * Scrubbing: the playhead is about to be dragged, so stop making sound.
   *
   * A drag emits a seek per pointer move, and re-seeking a playing element 60
   * times a second is a stutter, not a scrub. Duck and pause for the duration of
   * the gesture, then land on the release point and resume.
   */
  beginScrub(): void {
    if (this.scrubbing) return
    this.scrubbing = true
    const focused = this.focusedId ? this.tracks.get(this.focusedId) : null
    if (focused) this.fade(focused, 0, () => focused.el.pause())
  }

  endScrub(): void {
    if (!this.scrubbing) return
    this.scrubbing = false
    if (this.focusedId && this.playing) void this.startTrack(this.focusedId)
  }

  /** Move the playhead. `p` is 0..1 through the script. */
  seek(p: number): void {
    this.progress = Math.min(Math.max(p, 0), 1)
    const focused = this.focusedId ? this.tracks.get(this.focusedId) : null
    // Mid-scrub the element is paused and silent, so aligning it every move is
    // wasted seeking; endScrub aligns once on release.
    if (focused && !this.scrubbing) this.align(focused, true)
    else if (focused) this.elapsed = this.localPosition(focused, this.progress) * this.durationOf(focused)
    this.emit()
  }

  /**
   * Seek to a fraction of ONE VOICE's own clip, converted to script position.
   *
   * This is what the waveform needs. Its x axis is equal slices of that clip's
   * duration, which is not the canonical script timeline: click halfway along
   * Bree's waveform and the word there is not the word halfway through the
   * script. Passing the raw fraction to `seek` would land on the wrong word,
   * which is the same mistake as the old fraction-of-duration handoff.
   */
  seekLocal(id: string, fraction: number): void {
    const track = this.tracks.get(id)
    if (!track) return
    const local = Math.min(Math.max(fraction, 0), 1)
    this.seek(toCanonical(track.starts, this.opts.canonicalStarts, local))
  }

  /**
   * Nudge by seconds of the audible clip.
   *
   * Not `progress + seconds / reference`: that is the same
   * fraction-of-duration mistake `elapsed` was fixed for, in reverse. Arrowing
   * 5 seconds while Bree (142s) is playing would move the playhead by 5/101 of
   * the script, which is about 7 seconds of her audio.
   */
  nudge(seconds: number): void {
    const focused = this.focusedId ? this.tracks.get(this.focusedId) : null
    if (!focused) {
      this.seek(this.progress + seconds / this.opts.referenceDuration)
      return
    }
    const duration = this.durationOf(focused)
    const local = this.localPosition(focused, this.progress) + seconds / duration
    this.seek(toCanonical(focused.starts, this.opts.canonicalStarts, Math.min(Math.max(local, 0), 1)))
  }

  /**
   * The hover handler. `null` means nothing is hovered: we duck to silence but
   * keep the playhead running, so sweeping the cursor across the grid reads as
   * one continuous take with the voice swapping under it.
   */
  focus(id: string | null): void {
    if (id === this.focusedId) return
    const previous = this.focusedId
    this.focusedId = id

    if (previous) {
      const prev = this.tracks.get(previous)
      if (prev) this.fade(prev, 0, () => prev.el.pause())
    }

    if (id && this.playing) {
      void this.startTrack(id)
    } else if (id) {
      // Paused. Still put the element and the readout on the playhead, or the
      // transport shows the previous voice's seconds against this one's total.
      const track = this.tracks.get(id)
      if (track) this.align(track, true)
    }
    this.emit()
  }

  destroy(): void {
    this.scrubbing = false
    this.stopLoop()
    for (const id of [...this.tracks.keys()]) this.unregister(id)
    for (const timer of this.fadeTimers.values()) clearInterval(timer)
    this.fadeTimers.clear()
  }

  // --- internals ----------------------------------------------------------

  private durationOf(track: Track): number {
    const reported = track.el.duration
    return Number.isFinite(reported) && reported > 0 ? reported : track.declared
  }

  private async startTrack(id: string): Promise<void> {
    const track = this.tracks.get(id)
    if (!track || this.failed.has(id)) return
    // metadata-only preload keeps 36 idle tiles cheap; upgrade on first focus.
    track.el.preload = 'auto'
    this.starting += 1
    try {
      this.align(track, true)
      await track.el.play()
    } catch {
      // Autoplay refusal or a load race. Not fatal: the transport keeps running
      // and the next hover retries. A genuinely broken clip surfaces via the
      // 'error' listener instead.
      return
    } finally {
      this.starting -= 1
    }
    if (this.focusedId === id) this.fade(track, 1)
  }

  /**
   * Whether this element's own clock can be trusted right now.
   *
   * `seeking` is the standard flag for "currentTime is in flight"; below
   * HAVE_METADATA the element has no duration and reports 0, which would map to
   * the top of the script.
   */
  private readable(track: Track): boolean {
    return !track.el.paused && !track.el.seeking && track.el.readyState >= 1
  }

  /** This voice's own 0..1 position for a canonical script position. */
  private localPosition(track: Track, p: number): number {
    return fromCanonical(track.starts, this.opts.canonicalStarts, p)
  }

  /** Put an element at the playhead, converted into its own timeline. */
  private align(track: Track, force = false): void {
    const target = this.localPosition(track, this.progress) * this.durationOf(track)
    if (!Number.isFinite(target)) return
    if (force || Math.abs(track.el.currentTime - target) > SEEK_EPSILON) {
      try {
        track.el.currentTime = target
        if (this.focusedId === track.id) this.elapsed = target
      } catch {
        // Seeking before metadata lands throws in some browsers. The next
        // focus re-aligns, so drop it.
      }
    }
  }

  private loop(): void {
    const tick = (now: number) => {
      if (!this.playing) return
      const dt = (now - this.lastTick) / 1000
      this.lastTick = now

      const focused = this.focusedId ? this.tracks.get(this.focusedId) : null
      if (this.scrubbing) {
        // The drag owns the playhead. Nothing else may move it.
      } else if (this.starting > 0) {
        // Handoff in flight. Hold the playhead where it is: advancing it here is
        // what used to make the ticker snap backward once the element took over.
      } else if (focused && this.readable(focused)) {
        // An audible element is the source of truth, read back through its own
        // timeline so the shared playhead stays in canonical script space.
        const dur = this.durationOf(focused)
        if (dur > 0) {
          this.elapsed = focused.el.currentTime
          const local = Math.min(this.elapsed / dur, 1)
          this.progress = toCanonical(focused.starts, this.opts.canonicalStarts, local)
        }
      } else if (!focused) {
        // Nothing audible: run the playhead on the wall clock at median pace.
        this.progress += dt / this.opts.referenceDuration
      } else {
        // Focused but not readable yet (buffering, or a seek landing). Advance
        // at the focused voice's own pace so the ticker keeps gliding, rather
        // than at the median, which would drift against the audio it resumes to.
        const dur = this.durationOf(focused)
        if (dur > 0) {
          this.elapsed += dt
          this.progress = toCanonical(
            focused.starts,
            this.opts.canonicalStarts,
            Math.min(this.elapsed / dur, 1),
          )
        }
      }

      // Not while a scrub owns the playhead: dragging to the right edge lands on
      // exactly 1, and the reset would flip the ticker between the last word and
      // the first on every frame for as long as the drag was held there.
      // Loops rather than stopping: this is a browsing tool, and running out of
      // script mid-sweep would mean reaching for the play button.
      if (this.progress >= 1 && !this.scrubbing) {
        this.progress = 0
        if (focused) this.align(focused, true)
      }

      this.emit()
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private stopLoop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
  }

  private clearFade(id: string): void {
    const timer = this.fadeTimers.get(id)
    if (timer) clearInterval(timer)
    this.fadeTimers.delete(id)
  }

  private fade(track: Track, to: number, done?: () => void): void {
    this.clearFade(track.id)
    const from = track.el.volume
    const step = (to - from) / FADE_STEPS
    if (step === 0) {
      track.el.volume = to
      done?.()
      return
    }
    let i = 0
    const timer = setInterval(() => {
      i += 1
      const next = i >= FADE_STEPS ? to : from + step * i
      track.el.volume = Math.min(Math.max(next, 0), 1)
      if (i >= FADE_STEPS) {
        this.clearFade(track.id)
        done?.()
      }
    }, FADE_MS / FADE_STEPS)
    this.fadeTimers.set(track.id, timer)
  }

  private emit(): void {
    this.opts.onUpdate?.(this.getState())
  }
}
