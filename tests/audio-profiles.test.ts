import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUDIO_PROFILE,
  EXPRESSIVITY_LEVELS,
  OUTPUT_PROFILES,
  audioProfileId,
  analysisKey,
  trackKey,
} from '../src/lib/audio-profiles.ts'

describe('bounded audition matrix', () => {
  it('has exactly three expression levels by two output profiles', () => {
    const ids = EXPRESSIVITY_LEVELS.flatMap((expression) =>
      OUTPUT_PROFILES.map((output) => audioProfileId(expression.id, output.id)),
    )
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6)
  })

  it('uses the production-tuned full-band profile by default', () => {
    expect(DEFAULT_AUDIO_PROFILE).toBe('default-studio')
  })

  it('labels timing and waveform data by voice and synthesis profile', () => {
    expect(trackKey('flux-bree-en', 'calm-telephony')).toBe('flux-bree-en:calm-telephony')
  })

  it('never reuses legacy analysis for a different synthesized take', () => {
    expect(analysisKey('flux-bree-en', 'animated-telephony', true))
      .toBe('flux-bree-en:animated-telephony')
    expect(analysisKey('flux-bree-en', 'default-studio', false)).toBe('flux-bree-en')
  })

  it('defines telephony as genuine 8 kHz mu-law source audio', () => {
    expect(OUTPUT_PROFILES.find((profile) => profile.id === 'telephony')).toMatchObject({
      sampleRate: 8000,
      encoding: 'mulaw',
    })
  })
})
