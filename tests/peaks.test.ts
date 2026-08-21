import { describe, expect, it } from 'vitest'
import { bucketRms } from '../scripts/peaks.ts'
import { peaksPath } from '../src/lib/peaks.ts'

function tone(length: number, amplitude: number): Int16Array {
  const out = new Int16Array(length)
  for (let i = 0; i < length; i += 1) out[i] = Math.round(Math.sin(i) * amplitude * 32767)
  return out
}

describe('bucketRms', () => {
  it('returns one value per bucket', () => {
    expect(bucketRms(tone(8000, 0.5), 16)).toHaveLength(16)
  })

  it('stays inside 0..1', () => {
    for (const v of bucketRms(tone(8000, 0.9), 24)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('stretches a narrow input range across the full height', () => {
    // The reason the stretch exists: at ~1.7s per bar, raw RMS on real speech
    // spans about 0.30 to 1.00 and draws as a flat block.
    const samples = new Int16Array(4000)
    for (let i = 0; i < samples.length; i += 1) {
      const loud = i > samples.length / 2 ? 1 : 0.75
      samples[i] = Math.round(Math.sin(i) * loud * 20000)
    }
    const out = bucketRms(samples, 8)
    expect(Math.max(...out)).toBeCloseTo(1, 2)
    expect(Math.min(...out)).toBeLessThan(0.2)
  })

  it('gives silence a visible floor rather than a gap in the bar row', () => {
    const out = bucketRms(new Int16Array(1000), 8)
    expect(out.every((v) => v > 0)).toBe(true)
  })

  it('handles empty input', () => {
    expect(bucketRms(new Int16Array(0), 4)).toEqual([0, 0, 0, 0])
  })

  it('handles fewer samples than buckets without producing NaN', () => {
    expect(bucketRms(tone(3, 0.5), 10).every(Number.isFinite)).toBe(true)
  })
})

describe('peaksPath', () => {
  it('emits one closed bar per peak', () => {
    const d = peaksPath([0.2, 0.6, 1])
    expect((d.match(/M/g) ?? []).length).toBe(3)
    expect((d.match(/z/g) ?? []).length).toBe(3)
  })

  it('makes a louder bucket a taller bar', () => {
    const quiet = peaksPath([0.1])
    const loud = peaksPath([1])
    const topOf = (d: string) => Number(d.match(/M[\d.]+ ([\d.]+)/)![1])
    // Smaller y is higher up, so the loud bar starts closer to the top.
    expect(topOf(loud)).toBeLessThan(topOf(quiet))
  })

  it('gives a zero peak a floor, so the bar row stays continuous', () => {
    expect(peaksPath([0])).toContain('M')
  })

  it('returns an empty string for no peaks rather than a broken path', () => {
    expect(peaksPath([])).toBe('')
  })

  it('produces only finite coordinates', () => {
    const d = peaksPath([0, 0.5, 1])
    expect(d).not.toMatch(/NaN|Infinity|undefined/)
  })
})
