/**
 * Per-word positions in the audition script.
 *
 * Two sources, and the difference matters.
 *
 * REAL timings (`WordTimings`, loaded from `public/clips/timings.json`) come
 * from running each rendered clip back through STT and aligning the transcript
 * to the script. They are per voice and they are correct. This is what the
 * ticker uses.
 *
 * The syllable ESTIMATE below is the fallback for when timings.json is missing.
 * It is kept because the grid has to work before `pnpm align` has ever run, but
 * it is not good: measured against the real timings for all 36 voices it is out
 * by up to 8.9 seconds, 21 words. The estimate is ahead through the first half
 * of the script and behind through the second, because it cannot know that Flux
 * reads a line of acronyms and decimals far slower per syllable than it reads
 * short closing sentences. That information is not in the text, so no retuning
 * of the pause constants fixes it. Do not "improve" the constants; run the
 * alignment.
 */

import { CLIP_SCRIPT_HASH, CLIP_TEXT, CLIP_WORD_COUNT } from './clip-script.ts'

export type TimedWord = {
  text: string
  /** Normalized script position where this word starts, 0..1. */
  start: number
  /** Normalized script position where the next word starts, 0..1. */
  end: number
  /** Syllables plus any punctuation pause. What the estimate is derived from. */
  weight: number
}

const SYLLABLE_WEIGHT = 1
const PAUSE_CLAUSE = 0.5 // , ; : -- a breath, not a stop
const PAUSE_SENTENCE = 2 // . ? ! -- a real stop

/**
 * Vowel-group count, floored at one. Crude but directionally right, and it
 * degrades gracefully: a word it gets wrong is off by one syllable, not by a
 * whole word.
 */
export function syllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!letters) return 1
  const groups = letters.match(/[aeiouy]+/g)?.length ?? 1
  // Trailing silent "e" as in "shape", but not "the" or "be".
  const silentE = letters.length > 3 && letters.endsWith('e') && !/[aeiouy]e$/.test(letters)
  return Math.max(1, groups - (silentE ? 1 : 0))
}

export function buildWordTimeline(text: string): TimedWord[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  const weights = tokens.map((token) => {
    let weight = syllables(token) * SYLLABLE_WEIGHT
    if (/[.?!]["')\]]?$/.test(token)) weight += PAUSE_SENTENCE
    else if (/[,;:]["')\]]?$/.test(token)) weight += PAUSE_CLAUSE
    return weight
  })

  const total = weights.reduce((a, b) => a + b, 0) || 1
  let cursor = 0
  return tokens.map((text_, i) => {
    const start = cursor / total
    cursor += weights[i]!
    return { text: text_, start, end: cursor / total, weight: weights[i]! }
  })
}

export const WORD_TIMELINE = buildWordTimeline(CLIP_TEXT)

/** Normalized start position per script word, from the estimate. The fallback. */
export const ESTIMATED_STARTS = WORD_TIMELINE.map((w) => w.start)

/** Shape of `public/clips/timings.json`, written by `pnpm align`. */
export type WordTimings = {
  generatedAt: string
  /** Hash of CLIP_TEXT when the alignment ran. A mismatch means stale timings. */
  scriptHash: string
  model: string
  wordCount: number
  /** Voice id to normalized (0..1) start position per script word. */
  voices: Record<string, number[]>
}

/**
 * Real timings if they are present, current, and structurally sound; otherwise
 * null.
 *
 * Everything is validated once, here, rather than guarded per call in the hot
 * path: the word count, the script hash, and the length of every per-voice
 * array. A voice whose array is the wrong length is dropped rather than padded,
 * because padding drags the canonical mean toward zero and corrupts every other
 * voice's mapping.
 *
 * A stale hash is treated as absent on purpose. Highlighting confidently wrong
 * words is worse than falling back to an estimate that is labelled as one, and
 * checking only the word count would keep stale timings live through any script
 * edit that happened to preserve it.
 */
export async function loadTimings(): Promise<WordTimings | null> {
  try {
    const res = await fetch('/clips/timings.json', { cache: 'no-cache' })
    if (!res.ok) return null
    const data = (await res.json()) as WordTimings
    if (data.wordCount !== CLIP_WORD_COUNT) return null
    if (data.scriptHash !== CLIP_SCRIPT_HASH) return null
    const voices = Object.fromEntries(
      Object.entries(data.voices ?? {}).filter(
        ([, starts]) => Array.isArray(starts) && starts.length === CLIP_WORD_COUNT,
      ),
    )
    return Object.keys(voices).length === 0 ? null : { ...data, voices }
  } catch {
    return null
  }
}

/**
 * The timeline to use when no single voice is speaking: the mean position of
 * each word across every aligned voice. Not any real voice, but far closer to
 * all of them than the syllable estimate is.
 */
export function meanStarts(timings: WordTimings | null, fallback: number[]): number[] {
  const all = Object.values(timings?.voices ?? {})
  if (all.length === 0) return fallback
  // Every array is CLIP_WORD_COUNT long: loadTimings drops any that is not.
  return Array.from({ length: all[0]!.length }, (_, i) => {
    let sum = 0
    for (const starts of all) sum += starts[i]!
    return sum / all.length
  })
}

/**
 * Index of the word at normalized position `p` in a plain starts array.
 * Binary search: this runs every animation frame.
 */
export function indexInStarts(starts: number[], p: number): number {
  if (starts.length === 0) return -1
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= p) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** How far through word `i` position `p` is, 0..1. Drives the smooth scroll. */
export function fractionThrough(starts: number[], i: number, p: number): number {
  const from = starts[i] ?? 0
  const to = starts[i + 1] ?? 1
  if (to <= from) return 0
  return Math.min(Math.max((p - from) / (to - from), 0), 1)
}
/**
 * Convert between one voice's own timeline and the canonical script timeline.
 *
 * This is what makes a handoff word-exact. The naive approach -- treat the
 * playhead as a fraction and seek the new voice to `fraction * itsDuration` --
 * assumes the two voices distribute their time through the script the same way,
 * only faster or slower. They do not. Each voice places its own pauses, so at
 * 40% of the way through Bree is on a different word than Drew, and swapping
 * between them mid-sentence lands you somewhere else in the sentence.
 *
 * So the shared playhead is a position in the SCRIPT, expressed on the canonical
 * (mean) timeline, and every voice converts it through its own word positions.
 * Same word in, same word out, whatever the pacing.
 *
 * A voice with no alignment is given the canonical timeline itself, so the
 * conversion is the identity and it behaves as the average voice. There is no
 * "no timeline" state -- see App.tsx.
 */

/**
 * Re-express position `x` from the `from` timeline on the `to` timeline, by word.
 *
 * Both public directions are this function with the arrays swapped. They were
 * written out twice and that is exactly where an asymmetry hides: the two
 * directions silently disagreeing is the failure the canonical-timeline design
 * exists to prevent, so there is one body.
 *
 * `loadTimings` validates lengths, and every track is given a real timeline, so
 * the mismatch guard should never fire. It is here anyway and it is ONE guard
 * covering both directions: when the two directions guarded separately they
 * disagreed, and `fromCanonical` with an empty voice timeline silently returned
 * a lerp into 0..1 while `toCanonical` returned the identity.
 */
function remap(from: number[], to: number[], x: number): number {
  if (from.length === 0 || from.length !== to.length) return x
  const i = indexInStarts(from, x)
  if (i < 0) return x
  const f = fractionThrough(from, i, x)
  const lo = to[i] ?? 0
  const hi = to[i + 1] ?? 1
  return Math.min(Math.max(lo + f * (hi - lo), 0), 1)
}

/** A voice's own normalized position -> canonical script position. */
export function toCanonical(voiceStarts: number[], canonical: number[], vp: number): number {
  return remap(voiceStarts, canonical, vp)
}

/** Canonical script position -> a voice's own normalized position. */
export function fromCanonical(voiceStarts: number[], canonical: number[], p: number): number {
  return remap(canonical, voiceStarts, p)
}
