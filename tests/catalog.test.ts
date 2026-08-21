import { describe, expect, it } from 'vitest'
import { FALLBACK_CATALOG, displayName, parseCatalogRow } from '../scripts/fallback-catalog.ts'
import { CLIP_SCRIPT, CLIP_TEXT } from '../src/lib/clip-script.ts'

describe('parseCatalogRow', () => {
  it('splits accent, gender, age band, and character words', () => {
    expect(parseCatalogRow('American F Young Adult, Clear, professional, calm')).toEqual({
      accent: 'American',
      gender: 'F',
      age: 'Young Adult',
      characteristics: ['Clear', 'professional', 'calm'],
    })
  })

  it('prefers the longer age band, so "Young Adult" never parses as "Young"', () => {
    expect(parseCatalogRow('British M Young Adult, Friendly').age).toBe('Young Adult')
    expect(parseCatalogRow('British F Young, Friendly').age).toBe('Young')
  })

  it('keeps multi-word accents intact', () => {
    expect(parseCatalogRow('Singaporean M Young Adult, Clear').accent).toBe('Singaporean')
  })

  it('survives a row with no gender letter', () => {
    const parsed = parseCatalogRow('Irish Adult, Friendly')
    expect(parsed.gender).toBe('')
    expect(parsed.accent).toBe('Irish')
  })

  it('parses every bundled row without producing an empty accent', () => {
    for (const [id, row] of Object.entries(FALLBACK_CATALOG)) {
      const parsed = parseCatalogRow(row)
      expect(parsed.accent, id).not.toBe('')
      expect(parsed.characteristics.length, id).toBeGreaterThan(0)
    }
  })
})

describe('displayName', () => {
  it('strips the flux prefix and language suffix', () => {
    expect(displayName('flux-bree-en')).toBe('Bree')
  })

  it('handles a studio-style id with an underscore', () => {
    expect(displayName('flux-haley_studio-en')).toBe('Haley Studio')
  })
})

describe('the audition script', () => {
  it('joins every section into the text that gets rendered', () => {
    for (const section of CLIP_SCRIPT) {
      expect(CLIP_TEXT).toContain(section.text)
    }
  })

  it('is long enough to be worth two minutes of listening', () => {
    // Roughly 150 wpm, so ~250 words is the floor for a ~100s clip. A shorter
    // script would make the whole pace comparison noise.
    expect(CLIP_TEXT.split(/\s+/).length).toBeGreaterThan(240)
  })

  it('has unique section ids, because the transport bar keys on them', () => {
    const ids = CLIP_SCRIPT.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
