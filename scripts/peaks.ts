/**
 * Amplitude peaks per clip, for the waveform on the focused tile.
 *
 *   pnpm peaks            compute anything missing
 *   pnpm peaks --force    recompute everything
 *
 * No API calls. This decodes the mp3s that are already on disk with ffmpeg, so
 * it is free to re-run and safe to chain after every render.
 *
 * RMS per bucket, then stretched across the clip's own range.
 *
 * The stretch is not cosmetic. A tile fits ~72 bars, and the clips are ~100
 * seconds, so each bar averages more than a second of continuous speech: raw RMS
 * comes out between 0.30 and 1.00 and draws as a flat block. Rescaling each clip
 * to its own min..max and applying a gamma turns the variation that is actually
 * there into something you can see.
 *
 * So this is a RELATIVE envelope, not absolute loudness. Comparing bar heights
 * between two voices means nothing; comparing shape within one clip does.
 */

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CLIP_SCRIPT_HASH } from '../src/lib/clip-script.ts'
import { CLIPS_DIR, CONCURRENCY, carryForward, mapLimit, readJson, runFfmpeg } from './shared.ts'
import type { ClipPeaks } from '../src/lib/peaks.ts'
import type { Manifest } from '../src/lib/voices.ts'

/** Enough to show phrasing in a 180px tile without being noise. */
const BUCKETS = 72
const DECODE_RATE = 8000

async function decode(clipPath: string): Promise<Int16Array> {
  const pcm = await runFfmpeg([
    '-i', clipPath,
    '-ac', '1', '-ar', String(DECODE_RATE), '-f', 's16le', 'pipe:1',
  ])
  // A view over the same bytes, not a copy.
  return new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
}

/** Perceptual curve applied after the range stretch. Above 1 deepens the dips. */
const GAMMA = 1.6
/** Bars never go fully flat, so a quiet stretch still reads as a bar row. */
const FLOOR = 0.08

/** RMS per bucket, stretched across the clip's own dynamic range. */
export function bucketRms(samples: Int16Array, buckets: number): number[] {
  if (samples.length === 0) return new Array(buckets).fill(0)
  const width = samples.length / buckets
  const out = new Array<number>(buckets)
  for (let b = 0; b < buckets; b += 1) {
    const from = Math.floor(b * width)
    const to = Math.min(Math.floor((b + 1) * width), samples.length)
    let sum = 0
    for (let i = from; i < to; i += 1) {
      const v = samples[i]! / 32768
      sum += v * v
    }
    out[b] = to > from ? Math.sqrt(sum / (to - from)) : 0
  }
  const loudest = Math.max(...out)
  const quietest = Math.min(...out)
  const span = loudest - quietest
  if (span <= 0) return out.map(() => FLOOR)
  return out.map((v) => {
    const stretched = ((v - quietest) / span) ** GAMMA
    return Math.round((FLOOR + stretched * (1 - FLOOR)) * 1000) / 1000
  })
}

export async function computePeaks(options: {
  voices: { id: string; clip: string }[]
  force?: boolean
}): Promise<void> {
  const outPath = path.join(CLIPS_DIR, 'peaks.json')
  const { carried, existing } = await carryForward<number[]>(
    outPath,
    (prior) => prior.scriptHash === CLIP_SCRIPT_HASH && prior.buckets === BUCKETS,
    options.force ?? false,
  )

  const todo = options.voices.filter((v) => !existing[v.id])
  if (todo.length === 0) {
    console.log(`Peaks: nothing to do (${Object.keys(carried).length} cached)`)
    return
  }
  console.log(`Computing peaks for ${todo.length} clips (${BUCKETS} buckets)`)

  // Starts from `carried`, not empty: a failure must not discard good data.
  const voices: Record<string, number[]> = { ...carried }
  const failures: string[] = []
  await mapLimit(todo, CONCURRENCY, async (voice) => {
    try {
      voices[voice.id] = bucketRms(
        await decode(path.join(CLIPS_DIR, path.basename(voice.clip))),
        BUCKETS,
      )
    } catch (err) {
      failures.push(`${voice.id}: ${(err as Error).message}`)
    }
  })

  const json = `${JSON.stringify({
    scriptHash: CLIP_SCRIPT_HASH,
    buckets: BUCKETS,
    voices,
  } satisfies ClipPeaks)}\n`
  await writeFile(outPath, json)
  console.log(
    `${Object.keys(voices).length} waveforms, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`,
  )
  if (failures.length) {
    console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`)
    process.exitCode = 1
  }
}

if (import.meta.filename === process.argv[1]) {
  const manifest = await readJson<Manifest>(path.join(CLIPS_DIR, 'manifest.json'))
  if (!manifest) throw new Error('No manifest.json. Run `pnpm clips` first.')
  await computePeaks({ voices: manifest.voices, force: process.argv.includes('--force') })
}
