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
import type { ClipEnvelope, ClipPeaks } from '../src/lib/peaks.ts'
import type { Manifest } from '../src/lib/voices.ts'

/** Enough to show phrasing in a 180px tile without being noise. */
const BUCKETS = 72
/**
 * Level samples per clip, for the orb. Nothing draws these, so the constraint
 * is time resolution rather than pixels: the clips run 84 to 142 seconds, so
 * 1536 puts a sample every 55-92ms. English syllables run about 200ms, which
 * means the orb moves per syllable. Dropping to the 72 the bars use would put
 * one sample every 1.4 seconds and the orb would barely move at all.
 *
 * Measured cost: 191 KB of JSON across 36 voices. It compresses to 69 KB, but
 * note that nothing currently serves it compressed -- `src/server/index.ts`
 * uses `express.static` and there is no `compression` middleware -- so 191 KB
 * is what a browser actually downloads today.
 *
 * Affordable anyway: peaks.json is fetched after first paint, the orb falls
 * back to a fixed pulse until it lands, and it is a quarter of a percent of the
 * 28 MB of audio it describes. If it ever needs to shrink, base64-encoding
 * `levels` (already exact 0..255 integers) roughly halves it, and 768 buckets
 * would halve it again at the cost of a sample every 110-185ms, which is at or
 * past the length of a syllable.
 */
const LEVEL_BUCKETS = 1536
const DECODE_RATE = 8000

async function decode(clipPath: string): Promise<Int16Array> {
  const pcm = await runFfmpeg([
    '-i', clipPath,
    '-ac', '1', '-ar', String(DECODE_RATE), '-f', 's16le', 'pipe:1',
  ])
  // A view over the same bytes, not a copy.
  return new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
}

/**
 * Raw RMS per bucket, 0..1, with no normalization at all.
 *
 * The windowing is the only thing the two envelopes share, and they must NOT
 * share what comes after it -- see the two exports below. Keeping the loop here
 * means an edge case in it (a clip shorter than the bucket count, a final
 * partial window) gets fixed once.
 */
function rmsPerBucket(samples: Int16Array, buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0)
  if (samples.length === 0) return out
  const width = samples.length / buckets
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
  return out
}

/** Perceptual curve applied after the range stretch. Above 1 deepens the dips. */
const GAMMA = 1.6
/** Bars never go fully flat, so a quiet stretch still reads as a bar row. */
const FLOOR = 0.08

/**
 * The drawn waveform: RMS stretched across the clip's own dynamic range.
 *
 * The stretch is what makes 72 bars legible when each one averages over a
 * second of continuous speech -- raw RMS lands between 0.30 and 1.00 and draws
 * as a flat block.
 */
export function bucketRms(samples: Int16Array, buckets: number): number[] {
  const out = rmsPerBucket(samples, buckets)
  if (samples.length === 0) return out
  const loudest = Math.max(...out)
  const quietest = Math.min(...out)
  const span = loudest - quietest
  if (span <= 0) return out.map(() => FLOOR)
  return out.map((v) => {
    const stretched = ((v - quietest) / span) ** GAMMA
    return Math.round((FLOOR + stretched * (1 - FLOOR)) * 1000) / 1000
  })
}

/**
 * Lifts quiet speech without flattening the pauses. Below 1, so it is the
 * opposite of the bars' GAMMA: the bars want contrast, the orb wants presence.
 */
const LEVEL_GAMMA = 0.75

/**
 * The orb's envelope: RMS over the clip's own peak, quantized 0..255.
 *
 * Deliberately NOT the range stretch `bucketRms` does. That maps each clip's
 * quietest bucket to zero, which for the orb would mean the softest moment of
 * every clip reads as total silence -- and because the stretch is per clip, a
 * uniformly loud read and a wildly dynamic one would both come out spanning the
 * full range. Dividing by the peak keeps a quiet passage looking quiet.
 */
export function bucketLevels(samples: Int16Array, buckets: number): number[] {
  const out = rmsPerBucket(samples, buckets)
  const loudest = Math.max(...out)
  if (loudest <= 0) return out.map(() => 0)
  return out.map((v) => Math.round((v / loudest) ** LEVEL_GAMMA * 255))
}

export async function computePeaks(options: {
  voices: { id: string; clip: string }[]
  force?: boolean
}): Promise<void> {
  const outPath = path.join(CLIPS_DIR, 'peaks.json')
  const { carried, existing } = await carryForward<ClipEnvelope>(
    outPath,
    // `levelBuckets` is part of the freshness test, so a file written before the
    // orb existed is discarded rather than carried forward half-shaped.
    (prior) =>
      prior.scriptHash === CLIP_SCRIPT_HASH &&
      prior.buckets === BUCKETS &&
      prior.levelBuckets === LEVEL_BUCKETS,
    options.force ?? false,
  )

  const todo = options.voices.filter((v) => !existing[v.id])
  if (todo.length === 0) {
    console.log(`Peaks: nothing to do (${Object.keys(carried).length} cached)`)
    return
  }
  console.log(
    `Computing peaks for ${todo.length} clips (${BUCKETS} bars, ${LEVEL_BUCKETS} levels)`,
  )

  // Starts from `carried`, not empty: a failure must not discard good data.
  const voices: Record<string, ClipEnvelope> = { ...carried }
  const failures: string[] = []
  await mapLimit(todo, CONCURRENCY, async (voice) => {
    try {
      // Decoded once, bucketed twice. The decode is the expensive half.
      const samples = await decode(path.join(CLIPS_DIR, path.basename(voice.clip)))
      voices[voice.id] = {
        bars: bucketRms(samples, BUCKETS),
        levels: bucketLevels(samples, LEVEL_BUCKETS),
      }
    } catch (err) {
      failures.push(`${voice.id}: ${(err as Error).message}`)
    }
  })

  // Refuse to write an empty file over a good one.
  //
  // `carryForward` returns nothing when the prior file fails the freshness test,
  // which every pre-orb peaks.json now does. Combine that with per-voice errors
  // being collected rather than thrown -- no ffmpeg, a bad clip -- and a total
  // failure would serialize `voices: {}` on top of the previous data. That file
  // then passes `loadPeaks`, because `{}` is truthy, so the grid would come up
  // with no waveforms and no reactive orbs and nothing anywhere would say why.
  if (Object.keys(voices).length === 0) {
    console.error(
      `All ${todo.length} clips failed, so peaks.json was left alone:\n  ${failures.join('\n  ')}`,
    )
    process.exitCode = 1
    return
  }

  const json = `${JSON.stringify({
    scriptHash: CLIP_SCRIPT_HASH,
    buckets: BUCKETS,
    levelBuckets: LEVEL_BUCKETS,
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
