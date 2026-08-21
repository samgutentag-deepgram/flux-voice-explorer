/**
 * Waveform data for the focused tile.
 *
 * Written by `pnpm peaks`, which decodes the mp3s locally -- no API calls, so it
 * is free to re-run. Only the ACTIVE tile draws its waveform, so this is loaded
 * eagerly (about 6 KB for all 36) but rendered at most once at a time.
 */

import { CLIP_SCRIPT_HASH } from './clip-script.ts'

export type ClipPeaks = {
  scriptHash: string
  buckets: number
  /** Voice id to RMS per bucket, normalized 0..1. */
  voices: Record<string, number[]>
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
