import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FALLBACK_CATALOG } from '../scripts/fallback-catalog.ts'
import { ORB_FAMILY_COUNT, mappedVoiceIds, orbFamily } from '../src/lib/voice-orbs.ts'

/**
 * The orb mapping is data with no runtime feedback: a wrong family paints a
 * plausible-looking wrong color, and a missing one paints the accent, which is
 * also a legitimate state. Neither throws. So the coverage that matters is the
 * boring kind -- every voice mapped, every family reachable, and the CSS side
 * actually defining the tokens the TS side promises.
 */

describe('orbFamily', () => {
  it('maps every voice in the catalog', () => {
    const unmapped = Object.keys(FALLBACK_CATALOG).filter((id) => orbFamily(id) === null)
    expect(unmapped).toEqual([])
  })

  it('returns families in 1..ORB_FAMILY_COUNT', () => {
    for (const id of mappedVoiceIds()) {
      const family = orbFamily(id)
      expect(family).toBeGreaterThanOrEqual(1)
      expect(family).toBeLessThanOrEqual(ORB_FAMILY_COUNT)
    }
  })

  it('uses every family it declares', () => {
    const used = new Set(mappedVoiceIds().map((id) => orbFamily(id)))
    const declared = Array.from({ length: ORB_FAMILY_COUNT }, (_, i) => i + 1)
    expect([...used].sort((a, b) => a! - b!)).toEqual(declared)
  })

  it('returns null for a voice with no orb, rather than guessing one', () => {
    // The catalog is the live /v2/models list, so this is the shape of every
    // future voice on the day it ships.
    expect(orbFamily('flux-notavoice-en')).toBeNull()
    expect(orbFamily('')).toBeNull()
  })

  it('maps exactly the catalog, with nothing left over', () => {
    // A voice removed upstream should be removed here too, or the mapping grows
    // stale invisibly.
    expect(mappedVoiceIds()).toEqual(Object.keys(FALLBACK_CATALOG).sort())
  })
})

describe('the orb style pack', () => {
  const pack = readFileSync(new URL('../src/styles/packs/flux-2026.css', import.meta.url), 'utf8')

  it('defines all five slots for every family', () => {
    const missing: string[] = []
    for (let f = 1; f <= ORB_FAMILY_COUNT; f++) {
      for (const slot of ['base', 'mid', 'hi', 'glow', 'wave']) {
        if (!pack.includes(`--dg-orb-f${f}-${slot}:`)) missing.push(`--dg-orb-f${f}-${slot}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('defines no family beyond the ones the mapping uses', () => {
    const declared = [...pack.matchAll(/--dg-orb-f(\d+)-base:/g)].map((m) => Number(m[1]))
    expect(declared.sort((a, b) => a - b)).toEqual(
      Array.from({ length: ORB_FAMILY_COUNT }, (_, i) => i + 1),
    )
  })
})

describe('the theme bridge', () => {
  const theme = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')

  it('has a data-orb rule for every family', () => {
    const missing: number[] = []
    for (let f = 1; f <= ORB_FAMILY_COUNT; f++) {
      if (!theme.includes(`[data-orb="${f}"]`)) missing.push(f)
    }
    expect(missing).toEqual([])
  })

  it('has a family-0 reset, so an unmapped tile cannot inherit .app colors', () => {
    expect(theme).toContain('[data-orb="0"]')
  })

  it('defaults every semantic orb slot, so an unmapped voice still paints', () => {
    for (const slot of ['base', 'mid', 'hi', 'glow', 'wave', 'ground']) {
      expect(theme).toContain(`--dg-orb-${slot}:`)
    }
  })
})
