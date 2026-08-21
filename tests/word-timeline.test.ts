import { describe, expect, it } from 'vitest'
import {
  ESTIMATED_STARTS,
  WORD_TIMELINE,
  buildWordTimeline,
  fractionThrough,
  fromCanonical,
  indexInStarts,
  meanStarts,
  syllables,
  toCanonical,
} from '../src/lib/word-timeline.ts'
import { CLIP_TEXT } from '../src/lib/clip-script.ts'

describe('syllables', () => {
  it('counts vowel groups, not characters', () => {
    // The whole reason for the estimator: seven characters, one syllable.
    expect(syllables('through')).toBe(1)
    expect(syllables('audio')).toBe(2)
    expect(syllables('professional')).toBe(4)
  })

  it('drops a silent trailing e', () => {
    expect(syllables('shape')).toBe(1)
    expect(syllables('voice')).toBe(1)
  })

  it('keeps a sounded trailing e in short words', () => {
    expect(syllables('the')).toBe(1)
    expect(syllables('be')).toBe(1)
  })

  it('never returns zero, even for punctuation-only tokens', () => {
    expect(syllables('---')).toBe(1)
    expect(syllables('')).toBe(1)
  })
})

describe('buildWordTimeline', () => {
  it('covers exactly 0 to 1 with no gaps', () => {
    const t = buildWordTimeline('one two three four')
    expect(t[0]!.start).toBe(0)
    expect(t.at(-1)!.end).toBeCloseTo(1, 10)
    for (let i = 1; i < t.length; i += 1) {
      expect(t[i]!.start).toBeCloseTo(t[i - 1]!.end, 10)
    }
  })

  it('gives a sentence end more room than a bare word', () => {
    const [plain, stop] = buildWordTimeline('go go.')
    expect(stop!.weight).toBeGreaterThan(plain!.weight)
  })

  it('gives a comma less pause than a full stop', () => {
    const comma = buildWordTimeline('go, go')[0]!
    const stop = buildWordTimeline('go. go')[0]!
    const bare = buildWordTimeline('go go')[0]!
    expect(comma.weight).toBeGreaterThan(bare.weight)
    expect(stop.weight).toBeGreaterThan(comma.weight)
  })

  it('sees punctuation through a closing quote', () => {
    expect(buildWordTimeline('said."')[0]!.weight).toBeGreaterThan(
      buildWordTimeline('said')[0]!.weight,
    )
  })

  it('gives a long word more room than a short one', () => {
    const t = buildWordTimeline('a professional')
    expect(t[1]!.end - t[1]!.start).toBeGreaterThan(t[0]!.end - t[0]!.start)
  })

  it('handles a single word without dividing by zero', () => {
    const t = buildWordTimeline('hello')
    expect(t).toHaveLength(1)
    expect(t[0]!.start).toBe(0)
    expect(t[0]!.end).toBeCloseTo(1, 10)
  })

  it('returns nothing for empty input rather than a phantom word', () => {
    expect(buildWordTimeline('   ')).toEqual([])
  })
})

describe('WORD_TIMELINE', () => {
  it('has one entry per word of the rendered script', () => {
    expect(WORD_TIMELINE).toHaveLength(CLIP_TEXT.split(/\s+/).filter(Boolean).length)
  })

  it('is the same word order as the text sent to the API', () => {
    expect(WORD_TIMELINE.map((w) => w.text).join(' ')).toBe(
      CLIP_TEXT.split(/\s+/).filter(Boolean).join(' '),
    )
  })
})

describe('real timings', () => {
  const timings = {
    generatedAt: '',
    scriptHash: 'abc',
    model: 'nova-3',
    wordCount: 3,
    voices: { fast: [0, 0.2, 0.6], slow: [0, 0.4, 0.8] },
  }

  it('meanStarts averages across every aligned voice', () => {
    expect(meanStarts(timings, [9, 9, 9])).toEqual([0, 0.30000000000000004, 0.7])
  })

  it('meanStarts falls back when nothing is aligned', () => {
    expect(meanStarts({ ...timings, voices: {} }, [1, 2, 3])).toEqual([1, 2, 3])
    expect(meanStarts(null, [1, 2, 3])).toEqual([1, 2, 3])
  })

  it('indexInStarts finds the word at a position', () => {
    const starts = [0, 0.25, 0.5, 0.75]
    expect(indexInStarts(starts, 0)).toBe(0)
    expect(indexInStarts(starts, 0.3)).toBe(1)
    expect(indexInStarts(starts, 0.75)).toBe(3)
    expect(indexInStarts(starts, 1)).toBe(3)
  })

  it('indexInStarts returns -1 for an empty timeline', () => {
    expect(indexInStarts([], 0.5)).toBe(-1)
  })

  it('indexInStarts agrees with a linear scan over the real estimate', () => {
    for (let i = 0; i <= 100; i += 1) {
      const p = i / 100
      const linear = ESTIMATED_STARTS.reduce((best, s, idx) => (s <= p ? idx : best), 0)
      expect(indexInStarts(ESTIMATED_STARTS, p)).toBe(linear)
    }
  })

  it('fractionThrough spans one word and clamps outside it', () => {
    const starts = [0, 0.5, 1]
    expect(fractionThrough(starts, 0, 0.25)).toBeCloseTo(0.5, 10)
    expect(fractionThrough(starts, 0, 0)).toBe(0)
    expect(fractionThrough(starts, 0, 0.9)).toBe(1)
  })

  it('fractionThrough handles the last word, which has no next start', () => {
    expect(fractionThrough([0, 0.5], 1, 0.75)).toBeCloseTo(0.5, 10)
  })

  it('fractionThrough returns 0 for a zero-width word', () => {
    expect(fractionThrough([0.5, 0.5], 0, 0.5)).toBe(0)
  })
})

describe('canonical mapping', () => {
  // Two voices that spend their time through the script very differently: the
  // first rushes the opening, the second dawdles through it.
  const canonical = [0, 0.25, 0.5, 0.75]
  const fast = [0, 0.1, 0.2, 0.9]
  const slow = [0, 0.4, 0.8, 0.9]

  it('round-trips a voice position through canonical space', () => {
    for (const vp of [0, 0.05, 0.15, 0.5, 0.95]) {
      const p = toCanonical(fast, canonical, vp)
      expect(fromCanonical(fast, canonical, p)).toBeCloseTo(vp, 8)
    }
  })

  it('maps the same word to the same word across two differently paced voices', () => {
    // Start of word 2 in the fast voice must land on start of word 2 in the slow
    // one. This is the whole point: a handoff keeps the WORD, not the fraction.
    const p = toCanonical(fast, canonical, fast[2]!)
    expect(fromCanonical(slow, canonical, p)).toBeCloseTo(slow[2]!, 8)
  })

  it('does not agree with a naive fraction-of-duration handoff', () => {
    // Pins that the mapping is doing real work: at word 2 the fast voice is 20%
    // through and the slow one 80%, so treating the fraction as shared would
    // land 2 words away.
    const p = toCanonical(fast, canonical, fast[2]!)
    expect(fromCanonical(slow, canonical, p)).not.toBeCloseTo(p, 2)
  })

  it('preserves the fraction through a word, so it glides rather than snaps', () => {
    const midWord1 = (fast[1]! + fast[2]!) / 2
    const p = toCanonical(fast, canonical, midWord1)
    expect(fromCanonical(slow, canonical, p)).toBeCloseTo((slow[1]! + slow[2]!) / 2, 8)
  })

  it('falls back to the identity for a voice with no alignment', () => {
    expect(fromCanonical([], canonical, 0.37)).toBe(0.37)
    expect(toCanonical([], canonical, 0.37)).toBe(0.37)
  })

  it('falls back to the identity on a length mismatch rather than mis-mapping', () => {
    expect(fromCanonical([0, 0.5], canonical, 0.37)).toBe(0.37)
  })

  it('stays inside 0..1', () => {
    for (const vp of [-1, 0, 1, 2]) {
      const p = toCanonical(fast, canonical, vp)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
  })
})
