import { CLIP_SCRIPT_HASH } from './clip-script.ts'

/**
 * The voice manifest. `public/clips/manifest.json` is written by
 * `scripts/generate-clips.ts` and is the only contract between the generator
 * and the UI: there is no build step tying them together, so the JSON *is* the
 * API.
 *
 * The catalog is NOT hardcoded here on purpose. The generator asks the live
 * Deepgram model list what exists, so the tile count is whatever the API is
 * actually serving today rather than whatever a table said last month.
 */

export type Voice = {
  /** Model string, e.g. `flux-bree-en`. What you pass as `model=`. */
  id: string
  /** Display name, e.g. `Bree`. */
  name: string
  accent: string
  /** `F`, `M`, or `` when the API does not say. */
  gender: string
  /** Age band, e.g. `Young Adult`. */
  age: string
  /**
   * Character words as Deepgram publishes them, e.g.
   * `['Clear', 'professional', 'calm']`. Taken from the docs table rather than
   * `/v2/models`, which returns a superset including words the docs leave off
   * (`robotic`, `angry`, `confused`). This is what the tiles show.
   */
  characteristics: string[]
  /**
   * The full tag list from the API. Searchable but never displayed, so filtering
   * still finds a voice by a trait the docs page does not print.
   */
  searchTerms: string[]
  /** What Deepgram suggests the voice for, e.g. `['IVR', 'Customer Service']`. */
  useCases: string[]
  /** Relative URL of the rendered clip. */
  clip: string
  /** Measured seconds. Differs per voice: same words, different pace. */
  duration: number
  bytes: number
}

export type Manifest = {
  generatedAt: string
  /**
   * Hash of CLIP_TEXT at render time (FNV-1a, see clip-script.ts). A mismatch
   * means the audio may be a different script from the one the UI shows -- the
   * one staleness failure with no visible tell, so it is surfaced rather than
   * ignored. See `LoadedManifest.stale`.
   */
  scriptHash: string
  /** Where the catalog came from: `api` (live model list) or `fallback`. */
  catalogSource: 'api' | 'fallback'
  /** The endpoint the catalog came from, recorded so drift is traceable. */
  catalogEndpoint: string
  model: string
  encoding: string
  sampleRate: number
  voices: Voice[]
}

/** A manifest plus whether its clips match the script this build was made from. */
export type LoadedManifest = Manifest & { stale: boolean }

export async function loadManifest(): Promise<LoadedManifest> {
  const res = await fetch('/clips/manifest.json', { cache: 'no-cache' })
  if (!res.ok) {
    throw new Error(
      `No clip manifest (HTTP ${res.status}). Run \`pnpm clips\` to render the audition set.`,
    )
  }
  // Defensive: a misconfigured host that serves index.html for /clips/* would
  // otherwise surface as an opaque JSON parse error.
  const data = await res.json().catch(() => {
    throw new Error('Clip manifest is not JSON. Is the server serving /clips correctly?')
  }) as Manifest
  if (!Array.isArray(data.voices) || data.voices.length === 0) {
    throw new Error('Clip manifest has no voices. Re-run `pnpm clips`.')
  }
  // Reported, not thrown.
  //
  // Stale audio is the one staleness failure with no visible tell -- the wrong
  // words under a correct ticker -- so it has to be surfaced. But throwing was
  // worse than the problem: it replaced a working grid with an error page whose
  // only remedy is 36 API calls, and it fires on a changed hash FUNCTION just as
  // readily as on a changed script. A banner says the same thing without
  // bricking the tool.
  return { ...data, stale: data.scriptHash !== CLIP_SCRIPT_HASH }
}

/** Median, used as the reference duration for the shared progress clock. */
export function medianDuration(voices: Voice[]): number {
  const sorted = voices.map((v) => v.duration).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Alphabetical, always. The dropdown filters narrow the set; a stable A-Z order
 * means a voice stays where you last saw it.
 *
 * This used to take a sort key and a direction, for a sort modal that no longer
 * exists. Sorting by pace, accent, gender, and age band went with it -- see
 * AGENTS.md, and commit 4a36813 if it is ever wanted back.
 */
export function sortByName(voices: Voice[]): Voice[] {
  return [...voices].sort((a, b) => a.name.localeCompare(b.name))
}

export function matchesQuery(v: Voice, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    v.name,
    v.id,
    v.accent,
    v.gender,
    v.age,
    ...v.characteristics,
    ...(v.searchTerms ?? []),
    ...v.useCases,
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

export function accentValues(voices: Voice[]): string[] {
  return [...new Set(voices.map((v) => v.accent).filter(Boolean))].sort()
}

/** Use cases are a list per voice, so they flatten rather than dedupe a column. */
export function useCaseValues(voices: Voice[]): string[] {
  return [...new Set(voices.flatMap((v) => v.useCases))].filter(Boolean).sort()
}
