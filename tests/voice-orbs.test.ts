import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ORB_FAMILY_BY_VOICE, ORB_FAMILY_COUNT, orbFamily } from '../src/lib/voice-orbs.ts'

/**
 * The orb mapping is data with no runtime feedback: a wrong family paints a
 * plausible-looking wrong color, and a missing one paints the accent, which is
 * also a legitimate state. Neither throws. So the coverage that matters is the
 * boring kind -- every orb mapped, every family reachable, and the CSS side
 * actually defining the tokens the TS side promises.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/**
 * The orb SVGs, which are the actual source of the mapping.
 *
 * Deliberately NOT `FALLBACK_CATALOG`. That list is the last-resort copy of the
 * voice catalog, and the orb map is not about which voices exist -- orb art is
 * not served by `/v2/models`. Checking against the catalog would re-pin it in a
 * second hardcoded place, and would turn the graceful `null` path into a red
 * test on the day a 37th voice ships with no orb exported yet.
 */
function orbFileIds(): string[] {
  return readdirSync(new URL('../assets/voice-orbs', import.meta.url))
    .filter((n) => n.endsWith('.svg'))
    .map((n) => n.replace(/\.svg$/, ''))
    .sort()
}

describe('orbFamily', () => {
  it('maps exactly the voices we have an orb file for', () => {
    expect(Object.keys(ORB_FAMILY_BY_VOICE).sort()).toEqual(orbFileIds())
  })

  it('uses every family it declares, and none beyond', () => {
    const used = [...new Set(Object.values(ORB_FAMILY_BY_VOICE))].sort((a, b) => a - b)
    expect(used).toEqual(Array.from({ length: ORB_FAMILY_COUNT }, (_, i) => i + 1))
  })

  it('returns null for a voice with no orb, rather than guessing one', () => {
    // The catalog is the live /v2/models list, so this is the shape of every
    // future voice on the day it ships.
    expect(orbFamily('flux-notavoice-en')).toBeNull()
    expect(orbFamily('')).toBeNull()
  })
})

describe('the orb style pack', () => {
  const pack = read('../src/styles/packs/flux-2026.css')

  it('defines all five slots for every family, and no extra family', () => {
    const missing: string[] = []
    for (let f = 1; f <= ORB_FAMILY_COUNT; f++) {
      for (const slot of ['base', 'mid', 'hi', 'glow', 'wave']) {
        if (!pack.includes(`--dg-orb-f${f}-${slot}:`)) missing.push(`--dg-orb-f${f}-${slot}`)
      }
    }
    expect(missing).toEqual([])

    const declared = [...pack.matchAll(/--dg-orb-f(\d+)-base:/g)].map((m) => Number(m[1]))
    expect(declared.sort((a, b) => a - b)).toEqual(
      Array.from({ length: ORB_FAMILY_COUNT }, (_, i) => i + 1),
    )
  })

  it('points every wave at its own family, so a stop cannot desync', () => {
    // Each `wave` is a copy of that family's `mid` or `hi`. Written as a var()
    // rather than a repeated literal, editing the stop moves the wave with it.
    for (let f = 1; f <= ORB_FAMILY_COUNT; f++) {
      const wave = pack.match(new RegExp(`--dg-orb-f${f}-wave:\\s*([^;]+);`))?.[1]
      expect(wave).toMatch(new RegExp(`^var\\(--dg-orb-f${f}-(mid|hi)\\)$`))
    }
  })
})

describe('the theme bridge', () => {
  const theme = read('../src/styles/theme.css')

  it('has a data-orb rule for every family', () => {
    const missing: number[] = []
    for (let f = 1; f <= ORB_FAMILY_COUNT; f++) {
      if (!theme.includes(`[data-orb="${f}"]`)) missing.push(f)
    }
    expect(missing).toEqual([])
  })

  it('defaults every semantic orb slot, so an unmapped voice still paints', () => {
    for (const slot of ['base', 'mid', 'hi', 'glow', 'wave', 'ground']) {
      expect(theme).toContain(`--dg-orb-${slot}:`)
    }
  })

  /**
   * The general form of a bug that shipped: `--dg-orb-glow` was declared twice
   * in `:root`, once as a color and once -- later, so it won -- as a length.
   * The orb's box-shadow silently became nonsense at the root, and only every
   * tile carrying `data-orb` hid it.
   *
   * Asserting the invariant rather than that one token, so the next collision is
   * caught too.
   */
  it('never declares a custom property twice in the same block', () => {
    const dupes: string[] = []
    for (const [, selector, body] of theme.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const seen = new Set<string>()
      for (const [, name] of body!.matchAll(/(--[\w-]+)\s*:/g)) {
        if (seen.has(name!)) dupes.push(`${selector!.trim()} { ${name} }`)
        seen.add(name!)
      }
    }
    expect(dupes).toEqual([])
  })
})

describe('the orb rules in app.css', () => {
  const app = read('../src/styles/app.css')

  it('excludes a failed tile from both speaking rules', () => {
    // `failed` and `focused` are independent, and the speaking selectors carry
    // more specificity than the failed rule, so without this exclusion a voice
    // whose clip 404'd kept swelling and brightening as if it were playing.
    // Asserted as text because the repo has no DOM to compute styles in.
    const speaking = app
      .split('\n')
      .filter(
        (l) =>
          l.includes('.tile-orb[data-reactive]') || l.includes('.tile-orb:not([data-reactive])'),
      )
    expect(speaking.length).toBeGreaterThanOrEqual(4)
    for (const selector of speaking) {
      expect(selector).toContain(':not([data-failed])')
    }
  })

  it('keeps opacity in the reactive rule transition', () => {
    // The reactive rule replaces the base rule's `transition` shorthand. Drop
    // opacity from the list and dim-to-lit snaps while lit-to-dim still fades.
    const rule = app.slice(
      app.indexOf('.tile[data-focused]:not([data-failed]) .tile-orb[data-reactive] {'),
    )
    expect(rule.slice(0, rule.indexOf('\n}'))).toContain('opacity var(--dg-anim-base)')
  })

  it('takes every orb duration from a token, so reduced motion reaches them', () => {
    // A raw `90ms` here would escape the pack's prefers-reduced-motion switch,
    // which is the whole reason durations are tokens in this repo.
    const orb = app.slice(app.indexOf('.tile-orb {'), app.indexOf('/* --- curtain'))
    expect(orb).not.toMatch(/\b\d+m?s\b(?![^/]*\*\/)/)
  })
})
