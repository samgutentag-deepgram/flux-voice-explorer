import type { Voice } from '../src/lib/voices.ts'

/** Keep an already-rendered matrix when refreshing only the legacy/default clip. */
export function preserveVariants(next: Voice, prior: Voice | undefined): Voice {
  return next.variants || !prior?.variants ? next : { ...next, variants: prior.variants }
}

/**
 * Build a failure-atomic catalog. A failed attempted voice keeps its last good
 * same-script row; a partial run also keeps rows it never attempted.
 */
export function mergeRenderedCatalog(
  prior: Voice[],
  rendered: Voice[],
  attemptedIds: string[],
  partial: boolean,
): Voice[] {
  const attempted = new Set(attemptedIds)
  const merged = new Map(
    prior
      .filter((voice) => partial || attempted.has(voice.id))
      .map((voice) => [voice.id, voice]),
  )
  for (const voice of rendered) merged.set(voice.id, voice)
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id))
}
