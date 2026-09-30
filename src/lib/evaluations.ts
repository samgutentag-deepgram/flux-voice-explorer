import { useCallback, useEffect, useState } from 'react'
import type { Voice } from './voices.ts'

export const RUBRIC = [
  { key: 'latency', label: 'Responsiveness', hint: 'Time to first audio in a live test. Static clips cannot measure this.' },
  { key: 'intelligibility', label: 'Intelligibility', hint: 'Every word is easy to understand, including over telephony audio.' },
  { key: 'naturalness', label: 'Naturalness', hint: 'Sounds human and avoids synthetic artifacts.' },
  { key: 'expressivity', label: 'Expressivity & prosody', hint: 'Emotion, pacing, pauses, pitch, and emphasis fit the script.' },
  { key: 'fit', label: 'Voice fit', hint: 'Accent, timbre, age, persona, and use case fit the audience.' },
] as const

export type RubricKey = (typeof RUBRIC)[number]['key']
export type VoiceEvaluation = {
  heard: boolean
  notes: string
  ratings: Partial<Record<RubricKey, number>>
  updatedAt: number
}
export type Evaluations = Record<string, VoiceEvaluation>

const STORAGE_KEY = 'flux-voice-explorer:evaluations:v1'
const EMPTY: VoiceEvaluation = { heard: false, notes: '', ratings: {}, updatedAt: 0 }

export function evaluationFor(all: Evaluations, id: string): VoiceEvaluation {
  return all[id] ?? EMPTY
}

/**
 * Responsiveness is a live-test score, so it is recorded but kept out of the
 * average. A guess made against a pre-rendered clip would otherwise move the sort.
 */
const AVERAGED_KEYS = RUBRIC.map(({ key }) => key).filter((key) => key !== 'latency')

export function averageRating(value: VoiceEvaluation): number | null {
  const scores = AVERAGED_KEYS.map((key) => value.ratings[key]).filter(
    (score): score is number => typeof score === 'number',
  )
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null
}

export function sortByEvaluation(
  voices: Voice[],
  all: Evaluations,
  key: 'notes' | 'rating',
): Voice[] {
  return [...voices].sort((a, b) => {
    const left = evaluationFor(all, a.id)
    const right = evaluationFor(all, b.id)
    if (key === 'rating') {
      return (averageRating(right) ?? -1) - (averageRating(left) ?? -1) || a.name.localeCompare(b.name)
    }
    const leftNotes = left.notes.trim()
    const rightNotes = right.notes.trim()
    if (Boolean(leftNotes) !== Boolean(rightNotes)) return leftNotes ? -1 : 1
    return leftNotes.localeCompare(rightNotes) || a.name.localeCompare(b.name)
  })
}

/** Audible seconds on one voice before it counts as heard. */
export const HEARD_AFTER_SECONDS = 3

export type ListenTracker = { id: string | null; elapsed: number; listened: number; marked: boolean }
export const IDLE_LISTEN: ListenTracker = { id: null, elapsed: 0, listened: 0, marked: false }

/**
 * Advance the focused voice's audible time from one player update. Hovering or
 * tabbing across a tile focuses it without playing it, so focus alone is not
 * "heard". Only forward steps under a second count, which drops seeks and the
 * jump a handoff makes into a new voice's timeline.
 */
export function trackListening(
  prev: ListenTracker,
  sample: { focusedId: string | null; playing: boolean; elapsed: number },
): ListenTracker {
  if (!sample.focusedId) return IDLE_LISTEN
  if (sample.focusedId !== prev.id) {
    return { id: sample.focusedId, elapsed: sample.elapsed, listened: 0, marked: false }
  }
  const step = sample.elapsed - prev.elapsed
  const counts = sample.playing && step > 0 && step < 1
  return { ...prev, elapsed: sample.elapsed, listened: counts ? prev.listened + step : prev.listened }
}

export function parseEvaluations(raw: string | null): Evaluations {
  try {
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, candidate]) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
        const value = candidate as Partial<VoiceEvaluation>
        const ratings: Partial<Record<RubricKey, number>> =
          value.ratings && typeof value.ratings === 'object' ? value.ratings : {}
        return [[id, {
          heard: value.heard === true,
          notes: typeof value.notes === 'string' ? value.notes : '',
          ratings: Object.fromEntries(
            RUBRIC.flatMap(({ key }) => {
              const score = ratings[key]
              return Number.isInteger(score) && Number(score) >= 1 && Number(score) <= 5
                ? [[key, score]]
                : []
            }),
          ),
          updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
        } satisfies VoiceEvaluation]]
      }),
    )
  } catch {
    return {}
  }
}

export function useEvaluations() {
  const [evaluations, setEvaluations] = useState<Evaluations>(() => {
    try {
      return parseEvaluations(localStorage.getItem(STORAGE_KEY))
    } catch {
      return {}
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(evaluations))
    } catch {
      // Private browsing and storage policies can reject writes. The current
      // session remains usable even when persistence is unavailable.
    }
  }, [evaluations])

  const update = useCallback((id: string, patch: Partial<VoiceEvaluation>) => {
    setEvaluations((current) => {
      const previous = evaluationFor(current, id)
      if (patch.heard === true && previous.heard && Object.keys(patch).length === 1) return current
      return { ...current, [id]: { ...previous, ...patch, updatedAt: Date.now() } }
    })
  }, [])

  const setRating = useCallback((id: string, key: RubricKey, score: number) => {
    setEvaluations((current) => {
      const previous = evaluationFor(current, id)
      return {
        ...current,
        [id]: {
          ...previous,
          ratings: { ...previous.ratings, [key]: score },
          updatedAt: Date.now(),
        },
      }
    })
  }, [])

  return { evaluations, update, setRating }
}
