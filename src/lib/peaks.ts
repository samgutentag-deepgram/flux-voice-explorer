/**
 * Waveform data for the focused tile.
 *
 * Written by `pnpm peaks`, which decodes the mp3s locally -- no API calls, so it
 * is free to re-run. Only the ACTIVE tile draws its waveform, so this is loaded
 * eagerly (about 6 KB for all 36) but rendered at most once at a time.
 */

import { CLIP_SCRIPT_HASH } from './clip-script.ts'

/**
 * Two envelopes per clip, at two resolutions, because the two things that read
 * them want opposite treatments.
 */
export type ClipEnvelope = {
  /**
   * The drawn waveform. Coarse (72), and stretched across the clip's own
   * dynamic range so a row of bars has visible contrast. One bar is well over
   * a second of speech.
   */
  bars: number[]
  /**
   * The reactive orb. Fine (see `levelBuckets`, ~14 a second), quantized to
   * 0..255 to keep the file small, and normalized only against the clip's
   * loudest bucket rather than range-stretched -- the orb should sit low
   * through a quiet passage instead of being pushed up to full contrast the
   * way the bars deliberately are.
   */
  levels: number[]
}

export type ClipPeaks = {
  scriptHash: string
  /** Bars per clip. */
  buckets: number
  /** Level samples per clip. Absent in files written before the orb existed. */
  levelBuckets: number
  voices: Record<string, ClipEnvelope>
}

export async function loadPeaks(): Promise<ClipPeaks | null> {
  try {
    const res = await fetch('/clips/peaks.json', { cache: 'no-cache' })
    if (!res.ok) return null
    const data = (await res.json()) as ClipPeaks
    // Stale peaks belong to a different script, so they would draw the wrong
    // pauses in the wrong places. Absent is better than wrong.
    if (data.scriptHash !== CLIP_SCRIPT_HASH) return null
    if (!data.buckets || !data.voices) return null
    // A peaks.json from before the orb has no `levels` and its `voices` values
    // are bare arrays, not `{ bars, levels }`. Rejecting it outright is right:
    // the alternative is a grid of tiles whose waveforms are `undefined`.
    // `pnpm peaks --force` rewrites it, and costs nothing but ffmpeg time.
    if (!data.levelBuckets) return null
    return data
  } catch {
    return null
  }
}

/**
 * One SVG path of vertical bars, mirrored about the mid-line.
 *
 * A single path rather than N rects: 72 bars as elements is 72 nodes per tile,
 * and this is drawn inside a component that re-renders every animation frame.
 * The viewBox is `0 0 buckets 100` with `preserveAspectRatio="none"`, so bars
 * stretch with the tile and need no re-measuring on resize.
 */
export function peaksPath(peaks: number[]): string {
  const half = 46
  const barWidth = 0.62
  const inset = (1 - barWidth) / 2
  let d = ''
  for (let i = 0; i < peaks.length; i += 1) {
    // A floor so silence is a visible baseline rather than a gap in the bar row.
    const h = Math.max((peaks[i] ?? 0) * half, 0.9)
    d += `M${(i + inset).toFixed(2)} ${(50 - h).toFixed(2)}h${barWidth}v${(2 * h).toFixed(2)}h-${barWidth}z`
  }
  return d
}

/**
 * Amplitude at a position through the clip, 0..1, for the reactive orb.
 *
 * Interpolated between neighbouring buckets rather than snapped to one. The
 * levels arrive at roughly fourteen a second and this is read every animation
 * frame, so without the interpolation the orb would visibly step about ten
 * times a second -- which looks like a dropped frame, not like speech.
 *
 * Reading it off POSITION rather than off the audio output has a side effect
 * worth keeping: the orb is also correct while the playhead is paused or being
 * scrubbed, so dragging the transport bar makes it move.
 */
export function levelAt(levels: number[] | null | undefined, progress: number): number {
  if (!levels || levels.length === 0) return 0
  const p = Math.min(Math.max(progress, 0), 1)
  // Across bucket centres, so progress 1 lands ON the last bucket instead of
  // one bucket past the end of the array.
  const x = p * (levels.length - 1)
  const i = Math.floor(x)
  const a = levels[i] ?? 0
  const b = levels[Math.min(i + 1, levels.length - 1)] ?? a
  return (a + (b - a) * (x - i)) / 255
}
