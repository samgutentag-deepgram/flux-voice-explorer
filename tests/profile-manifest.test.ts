import { describe, expect, it } from 'vitest'
import { mergeRenderedCatalog, preserveVariants } from '../scripts/profile-manifest.ts'
import type { Voice } from '../src/lib/voices.ts'

function voice(id: string, marker = id): Voice {
  return {
    id, name: marker, accent: '', gender: '', age: '', characteristics: [],
    searchTerms: [], useCases: [], clip: `/${marker}.mp3`, duration: 1, bytes: 1,
  }
}

describe('profile manifest updates', () => {
  it('preserves a complete matrix during an ordinary clip refresh', () => {
    const prior = { ...voice('bree', 'old'), variants: { 'default-studio': {
      clip: '/profile.mp3', duration: 2, bytes: 2, sampleRate: 24000,
      encoding: 'linear16' as const, expressivity: 0 as const,
    } } }
    expect(preserveVariants(voice('bree', 'new'), prior).variants).toEqual(prior.variants)
  })

  it('keeps unattempted rows during a partial run', () => {
    const result = mergeRenderedCatalog(
      [voice('alexis', 'old-a'), voice('bree', 'old-b')],
      [voice('bree', 'new-b')],
      ['bree'],
      true,
    )
    expect(result.map((entry) => entry.name)).toEqual(['old-a', 'new-b'])
  })

  it('keeps the prior row when one attempted voice fails', () => {
    const result = mergeRenderedCatalog(
      [voice('alexis', 'old-a'), voice('bree', 'old-b')],
      [voice('alexis', 'new-a')],
      ['alexis', 'bree'],
      false,
    )
    expect(result.map((entry) => entry.name)).toEqual(['new-a', 'old-b'])
  })

  it('drops voices no longer present in the live catalog on a full run', () => {
    const result = mergeRenderedCatalog([voice('gone')], [voice('bree')], ['bree'], false)
    expect(result.map((entry) => entry.id)).toEqual(['bree'])
  })
})
