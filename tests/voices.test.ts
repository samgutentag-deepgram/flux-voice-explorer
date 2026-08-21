import { afterEach, describe, expect, it } from 'vitest'
import { CLIP_SCRIPT_HASH } from '../src/lib/clip-script.ts'
import {
  loadManifest,
  matchesQuery,
  medianDuration,
  sortByName,
  useCaseValues,
  type Voice,
} from '../src/lib/voices.ts'

function voice(partial: Partial<Voice> & { id: string }): Voice {
  return {
    name: partial.id,
    accent: 'American',
    gender: 'F',
    age: 'Adult',
    characteristics: ['clear'],
    searchTerms: ['clear'],
    useCases: ['IVR'],
    clip: `/clips/${partial.id}.mp3`,
    duration: 100,
    bytes: 1000,
    ...partial,
  }
}

describe('medianDuration', () => {
  it('is the reference the shared playhead runs at', () => {
    expect(medianDuration([voice({ id: 'a', duration: 100 }), voice({ id: 'b', duration: 120 })])).toBe(110)
  })

  it('takes the middle value for an odd count', () => {
    const set = [90, 100, 140].map((d, i) => voice({ id: `v${i}`, duration: d }))
    expect(medianDuration(set)).toBe(100)
  })

  it('returns 0 rather than NaN for an empty catalog', () => {
    expect(medianDuration([])).toBe(0)
  })

  it('is not thrown off by one very slow voice, which is why it is not the mean', () => {
    const set = [95, 100, 105, 400].map((d, i) => voice({ id: `v${i}`, duration: d }))
    expect(medianDuration(set)).toBe(102.5)
  })
})

describe('sortByName', () => {
  const set = [
    voice({ id: 'flux-kit-en', name: 'Kit' }),
    voice({ id: 'flux-bree-en', name: 'Bree' }),
    voice({ id: 'flux-alexis-en', name: 'Alexis' }),
  ]

  it('sorts A to Z', () => {
    expect(sortByName(set).map((v) => v.name)).toEqual(['Alexis', 'Bree', 'Kit'])
  })

  it('does not mutate its input', () => {
    const before = set.map((v) => v.name)
    sortByName(set)
    expect(set.map((v) => v.name)).toEqual(before)
  })

  it('handles an empty list', () => {
    expect(sortByName([])).toEqual([])
  })
})

describe('matchesQuery', () => {
  const bree = voice({
    id: 'flux-bree-en',
    name: 'Bree',
    characteristics: ['Friendly', 'sweet'],
    searchTerms: ['Friendly', 'sweet', 'robotic'],
    useCases: ['Customer Service'],
  })

  it('matches on the model id, not just the display name', () => {
    expect(matchesQuery(bree, 'flux-bree')).toBe(true)
  })

  it('matches a character word', () => {
    expect(matchesQuery(bree, 'sweet')).toBe(true)
  })

  it('is case and whitespace insensitive', () => {
    expect(matchesQuery(bree, '  FRIENDLY ')).toBe(true)
  })

  it('an empty query matches everything', () => {
    expect(matchesQuery(bree, '   ')).toBe(true)
  })

  it('matches a search-only tag the tile never displays', () => {
    // The API returns tags the docs page leaves off. They stay findable.
    expect(matchesQuery(bree, 'robotic')).toBe(true)
    expect(bree.characteristics).not.toContain('robotic')
  })

  it('matches a use case, so "IVR" finds the voices meant for it', () => {
    expect(matchesQuery(bree, 'customer service')).toBe(true)
  })

  it('does not match an unrelated term', () => {
    expect(matchesQuery(bree, 'scottish')).toBe(false)
  })
})

describe('useCaseValues', () => {
  it('flattens and dedupes across voices, since each voice has several', () => {
    const set = [
      voice({ id: 'a', useCases: ['IVR', 'Customer Service'] }),
      voice({ id: 'b', useCases: ['Customer Service', 'Casual Chat'] }),
    ]
    expect(useCaseValues(set)).toEqual(['Casual Chat', 'Customer Service', 'IVR'])
  })

  it('drops empties rather than rendering a blank filter option', () => {
    expect(useCaseValues([voice({ id: 'a', useCases: ['', 'IVR'] })])).toEqual(['IVR'])
  })
})

describe('loadManifest staleness', () => {
  const realFetch = globalThis.fetch

  function serve(body: unknown, status = 200) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch
  }

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  const base = { generatedAt: '', catalogSource: 'api', voices: [voice({ id: 'a' })] }

  it('flags a hash mismatch instead of throwing', async () => {
    // Throwing replaced a working grid with an error page whose only remedy was
    // 36 API calls -- and it fired on a changed hash FUNCTION as readily as on a
    // changed script, which is exactly how it went off in practice.
    serve({ ...base, scriptHash: 'deadbeef' })
    const loaded = await loadManifest()
    expect(loaded.stale).toBe(true)
    expect(loaded.voices).toHaveLength(1)
  })

  it('is not stale when the hash matches', async () => {
    serve({ ...base, scriptHash: CLIP_SCRIPT_HASH })
    expect((await loadManifest()).stale).toBe(false)
  })

  it('still throws when there are no voices at all', async () => {
    serve({ ...base, scriptHash: CLIP_SCRIPT_HASH, voices: [] })
    await expect(loadManifest()).rejects.toThrow(/no voices/i)
  })

  it('still throws on a missing file, with the fix in the message', async () => {
    serve({}, 404)
    await expect(loadManifest()).rejects.toThrow(/pnpm clips/)
  })
})
