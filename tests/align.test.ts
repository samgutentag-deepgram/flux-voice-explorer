import { describe, expect, it } from 'vitest'
import { alignWords, matchIndices, type SttWord } from '../scripts/align.ts'

const w = (word: string, start: number, end = start + 0.3): SttWord => ({ word, start, end })

describe('matchIndices', () => {
  it('matches an identical stream one to one', () => {
    expect(matchIndices(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([0, 1, 2])
  })

  it('ignores punctuation and case, which the transcript does not carry', () => {
    expect(matchIndices(['Hello,', 'World.'], ['hello', 'world'])).toEqual([0, 1])
  })

  it('absorbs an inserted transcript word', () => {
    // STT heard an extra "uh" that is not in the script.
    expect(matchIndices(['a', 'b'], ['a', 'uh', 'b'])).toEqual([0, 2])
  })

  it('absorbs a dropped transcript word', () => {
    expect(matchIndices(['a', 'b', 'c'], ['a', 'c'])).toEqual([0, null, 1])
  })

  it('leaves a genuine mismatch unmatched rather than trusting its timing', () => {
    // "429" against "four" is a diagonal pairing but not the same word, so its
    // timing must not be used as an anchor.
    expect(matchIndices(['429'], ['four'])).toEqual([null])
  })

  it('handles one side being empty', () => {
    expect(matchIndices(['a', 'b'], [])).toEqual([null, null])
    expect(matchIndices([], ['a'])).toEqual([])
  })
})

describe('alignWords', () => {
  it('normalizes against the clip duration so positions are 0..1', () => {
    const { starts } = alignWords(['a', 'b', 'c'], [w('a', 0), w('b', 5), w('c', 10)], 20)
    expect(starts).toEqual([0, 0.25, 0.5])
  })

  it('interpolates a word the transcript missed', () => {
    const { starts } = alignWords(['a', 'gap', 'c'], [w('a', 0), w('c', 10)], 10)
    expect(starts[1]).toBeCloseTo(0.5, 5)
  })

  it('interpolates evenly across a run of missed words', () => {
    const { starts } = alignWords(
      ['a', 'x', 'y', 'z', 'e'],
      [w('a', 0), w('e', 8)],
      8,
    )
    expect(starts).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('anchors both ends when the first and last words go unmatched', () => {
    const { starts } = alignWords(['x', 'b', 'y'], [w('b', 5)], 10)
    expect(starts[0]).toBe(0)
    expect(starts.at(-1)).toBe(1)
  })

  it('reports the match rate, which is how a bad alignment gets caught', () => {
    const result = alignWords(['a', 'b', 'c', 'd'], [w('a', 0), w('c', 2)], 4)
    expect(result.matched).toBe(2)
    expect(result.total).toBe(4)
  })

  it('never scrolls backwards, even if the transcript timestamps do', () => {
    // STT occasionally emits a word starting before the previous one ended.
    const { starts } = alignWords(['a', 'b', 'c'], [w('a', 5), w('b', 2), w('c', 8)], 10)
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i]!).toBeGreaterThanOrEqual(starts[i - 1]!)
    }
  })

  it('clamps into 0..1 when a timestamp exceeds the duration', () => {
    const { starts } = alignWords(['a', 'b'], [w('a', 0), w('b', 30)], 10)
    expect(Math.max(...starts)).toBeLessThanOrEqual(1)
  })

  it('does not divide by zero on a zero duration', () => {
    const { starts } = alignWords(['a'], [w('a', 0)], 0)
    expect(starts.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('returns nothing for an empty script', () => {
    expect(alignWords([], [w('a', 0)], 10).starts).toEqual([])
  })
})

describe('punctuation-only tokens', () => {
  it('never match each other, so they cannot plant a bogus anchor', () => {
    // Both normalize to '', which used to compare equal -- recording a match
    // with a meaningless timing AND inflating the rate MIN_MATCH_RATE gates on.
    expect(matchIndices(['--'], ['...'])).toEqual([null])
  })

  it('do not inflate the reported match rate', () => {
    const result = alignWords(['--', 'hello'], [w('...', 0), w('hello', 1)], 2)
    expect(result.matched).toBe(1)
    expect(result.total).toBe(2)
  })

  it('still align the real words around them', () => {
    const map = matchIndices(['a', '--', 'b'], ['a', '...', 'b'])
    expect(map[0]).toBe(0)
    expect(map[2]).toBe(2)
    expect(map[1]).toBeNull()
  })
})
