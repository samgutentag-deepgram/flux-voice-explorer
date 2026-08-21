/**
 * Send every rendered clip through STT and write real word timings.
 *
 *   pnpm align            align anything not already in timings.json
 *   pnpm align --force    re-align everything
 *
 * `pnpm clips` runs this automatically after rendering. Run it standalone when
 * you want to re-align without re-rendering, which is most of the time: the
 * clips cost a TTS call each, the alignment costs an STT call each and the STT
 * call is the cheap one.
 *
 * Output is `public/clips/timings.json`, normalized 0..1 per script word so the
 * ticker needs no per-voice conversion. The script hash goes in the file: if the
 * audition text changes, the timings are stale and the UI falls back to the
 * syllable estimate rather than highlighting the wrong words confidently.
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CLIP_SCRIPT_HASH, CLIP_WORDS } from '../src/lib/clip-script.ts'
import { alignWords, type SttWord } from './align.ts'
import {
  CLIPS_DIR,
  CONCURRENCY,
  carryForward,
  loadKey,
  mapLimit,
  readJson,
  type Credentials,
} from './shared.ts'
import type { Manifest, Voice } from '../src/lib/voices.ts'
import type { WordTimings } from '../src/lib/word-timeline.ts'

const STT_MODEL = 'nova-3'
/** Below this share of words matched outright, the alignment is not trustworthy. */
const MIN_MATCH_RATE = 0.8

/**
 * Transcribe one clip. `smart_format` and `numerals` are OFF on purpose: they
 * rewrite "twenty four" as "24", which is the opposite of what alignment needs
 * when the script spells its numbers out.
 */
async function transcribe(
  clipPath: string,
  key: string,
  host: string,
): Promise<{ words: SttWord[]; duration: number }> {
  const query = new URLSearchParams({
    model: STT_MODEL,
    punctuate: 'false',
    smart_format: 'false',
    numerals: 'false',
  })
  // Pass the Buffer straight through. `new Uint8Array(buf).buffer` copies every
  // byte, which at 4 concurrent ~1 MB clips was megabytes of pointless copies.
  const audio = await readFile(clipPath)
  const res = await fetch(`https://${host}/v1/listen?${query}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/mpeg' },
    body: audio,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as {
    metadata?: { duration?: number }
    results?: { channels?: { alternatives?: { words?: SttWord[] }[] }[] }
  }
  const words = body.results?.channels?.[0]?.alternatives?.[0]?.words
  if (!words?.length) throw new Error('no words in transcript')
  return { words, duration: body.metadata?.duration ?? words.at(-1)!.end }
}

export type AlignOptions = {
  /** Voices to consider. The generator passes what it just rendered. */
  voices: Voice[]
  force?: boolean
} & Partial<Credentials>

/**
 * Exported so `generate-clips` can chain it as a function call. It used to be
 * `await import('./align-clips.ts')` for the side effect of its top-level
 * `main()`, which meant the two CLIs shared `process.argv`: `pnpm clips --force
 * --only bree` rendered one clip and then re-aligned all 36, because align-clips
 * saw the generator's `--force`.
 */
export async function alignClips(options: AlignOptions): Promise<void> {
  const force = options.force ?? false
  const { key, host } = options.key && options.host ? (options as Credentials) : loadKey()
  const timingsPath = path.join(CLIPS_DIR, 'timings.json')

  const { carried, existing } = await carryForward<number[]>(
    timingsPath,
    (prior) => prior.scriptHash === CLIP_SCRIPT_HASH && prior.wordCount === CLIP_WORDS.length,
    force,
  )

  const todo = options.voices.filter((v) => !existing[v.id])
  console.log(`Aligning ${todo.length} of ${options.voices.length} clips (${STT_MODEL})`)
  if (todo.length === 0) {
    console.log('  nothing to do; use --force to re-align')
    return
  }

  const voices: Record<string, number[]> = { ...carried }
  let done = 0
  const failures: string[] = []

  await mapLimit(todo, CONCURRENCY, async (voice) => {
    try {
      const { words, duration } = await transcribe(
        path.join(CLIPS_DIR, path.basename(voice.clip)),
        key,
        host,
      )
      // The MANIFEST duration, not the STT-reported one. The browser recovers
      // position as `currentTime / el.duration`, and el.duration matches the
      // manifest (both are the container length); STT reports a consistent
      // +0.056s because it counts the mp3 encoder padding. Dividing by a
      // different number than the player multiplies by rescales every word
      // position by a constant factor.
      const result = alignWords(CLIP_WORDS, words, voice.duration || duration)
      const rate = result.matched / result.total
      done += 1
      console.log(
        `  [${String(done).padStart(2)}/${todo.length}] ${voice.id.padEnd(22)} ` +
          `${result.matched}/${result.total} matched (${(rate * 100).toFixed(0)}%)` +
          `${rate < MIN_MATCH_RATE ? '  LOW' : ''}`,
      )
      if (rate < MIN_MATCH_RATE) {
        // Keep going, but do not silently ship a bad alignment as if it were good.
        failures.push(`${voice.id}: only ${(rate * 100).toFixed(0)}% of words matched`)
        return
      }
      voices[voice.id] = result.starts.map((v) => Math.round(v * 1e5) / 1e5)
    } catch (err) {
      failures.push(`${voice.id}: ${(err as Error).message}`)
      console.error(`  FAILED ${voice.id}: ${(err as Error).message}`)
    }
  })

  const out: WordTimings = {
    generatedAt: new Date().toISOString(),
    scriptHash: CLIP_SCRIPT_HASH,
    model: STT_MODEL,
    wordCount: CLIP_WORDS.length,
    voices,
  }
  const json = `${JSON.stringify(out)}\n`
  await writeFile(timingsPath, json)

  console.log(
    `\n${Object.keys(voices).length} voices aligned, ${CLIP_WORDS.length} words each, ` +
      `${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`,
  )
  if (failures.length) {
    console.error(`\n${failures.length} not aligned:\n  ${failures.join('\n  ')}`)
    console.error('Those voices fall back to the syllable estimate in the UI.')
    process.exitCode = 1
  }
}

/** CLI entry. Kept thin: parse argv, read the manifest, delegate. */
if (import.meta.filename === process.argv[1]) {
  const manifest = await readJson<Manifest>(path.join(CLIPS_DIR, 'manifest.json'))
  if (!manifest) throw new Error('No manifest.json. Run `pnpm clips` first.')
  await alignClips({ voices: manifest.voices, force: process.argv.includes('--force') })
}
