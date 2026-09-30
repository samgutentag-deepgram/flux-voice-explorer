import { describe, expect, it } from 'vitest'
import {
  IDLE_LISTEN,
  averageRating,
  evaluationFor,
  trackListening,
  parseEvaluations,
  sortByEvaluation,
  type Evaluations,
} from '../src/lib/evaluations.ts'
import type { Voice } from '../src/lib/voices.ts'

const voices = [
  { id: 'a', name: 'Alexis' },
  { id: 'b', name: 'Bree' },
  { id: 'c', name: 'Colin' },
] as Voice[]

describe('voice evaluations', () => {
  it('returns a safe empty evaluation for a voice with no notes yet', () => {
    expect(evaluationFor({}, 'flux-bree-en')).toEqual({ heard: false, notes: '', ratings: {}, updatedAt: 0 })
  })

  it('averages only dimensions the listener has scored', () => {
    expect(averageRating({ heard: true, notes: '', ratings: { naturalness: 5, fit: 3 }, updatedAt: 1 })).toBe(4)
  })

  it('keeps the live-test responsiveness score out of the average', () => {
    expect(averageRating({ heard: true, notes: '', ratings: { latency: 1, fit: 5 }, updatedAt: 1 })).toBe(5)
    expect(averageRating({ heard: true, notes: '', ratings: { latency: 4 }, updatedAt: 1 })).toBeNull()
  })

  it('does not pretend an unscored voice has a zero rating', () => {
    expect(averageRating({ heard: false, notes: '', ratings: {}, updatedAt: 0 })).toBeNull()
  })

  it('sorts written notes first and leaves unnoted voices in name order', () => {
    const all = {
      a: { heard: true, notes: 'Warm', ratings: {}, updatedAt: 1 },
      b: { heard: true, notes: '', ratings: {}, updatedAt: 1 },
      c: { heard: true, notes: 'Clear', ratings: {}, updatedAt: 1 },
    } satisfies Evaluations
    expect(sortByEvaluation(voices, all, 'notes').map((voice) => voice.name)).toEqual(['Colin', 'Alexis', 'Bree'])
  })

  it('sorts rated voices highest first and unscored voices last', () => {
    const all = {
      a: { heard: true, notes: '', ratings: { fit: 3 }, updatedAt: 1 },
      c: { heard: true, notes: '', ratings: { fit: 5 }, updatedAt: 1 },
    } satisfies Evaluations
    expect(sortByEvaluation(voices, all, 'rating').map((voice) => voice.name)).toEqual(['Colin', 'Alexis', 'Bree'])
  })

  it('drops corrupt stored records and invalid rating values', () => {
    expect(parseEvaluations('{"bad":4,"good":{"heard":true,"notes":"yes","ratings":{"fit":9,"naturalness":5}}}')).toEqual({
      good: { heard: true, notes: 'yes', ratings: { naturalness: 5 }, updatedAt: 0 },
    })
    expect(parseEvaluations('not json')).toEqual({})
  })

  it('counts only audible forward playback toward heard', () => {
    let t = trackListening(IDLE_LISTEN, { focusedId: 'a', playing: false, elapsed: 10 })
    t = trackListening(t, { focusedId: 'a', playing: false, elapsed: 12 })
    expect(t.listened).toBe(0)
    t = trackListening(t, { focusedId: 'a', playing: true, elapsed: 12.5 })
    t = trackListening(t, { focusedId: 'a', playing: true, elapsed: 13 })
    expect(t.listened).toBeCloseTo(1)
  })

  it('ignores seeks and restarts the count on a new voice', () => {
    let t = trackListening(IDLE_LISTEN, { focusedId: 'a', playing: true, elapsed: 1 })
    t = trackListening(t, { focusedId: 'a', playing: true, elapsed: 40 })
    expect(t.listened).toBe(0)
    t = trackListening(t, { focusedId: 'a', playing: true, elapsed: 40.5 })
    t = trackListening(t, { focusedId: 'b', playing: true, elapsed: 41 })
    expect(t).toMatchObject({ id: 'b', listened: 0, marked: false })
    expect(trackListening(t, { focusedId: null, playing: true, elapsed: 41 })).toBe(IDLE_LISTEN)
  })
})
