import { describe, expect, it } from 'vitest'
import { bucketLevels, bucketRms } from '../scripts/peaks.ts'
import { levelAt, peaksPath } from '../src/lib/peaks.ts'

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

describe('bucketLevels', () => {
  it('returns one value per bucket, quantized to 0..255', () => {
    const out = bucketLevels(tone(8000, 0.6), 32)
    expect(out).toHaveLength(32)
    for (const v of out) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
  })

  it('puts the loudest bucket at full scale', () => {
    const samples = new Int16Array(800)
    for (let i = 400; i < 800; i += 1) samples[i] = Math.round(Math.sin(i) * 32767)
    expect(Math.max(...bucketLevels(samples, 2))).toBe(255)
  })

  it('keeps a quiet passage quiet, unlike the bars', () => {
    // Half loud, half at a tenth. bucketRms range-stretches the quiet half to
    // its FLOOR; bucketLevels must leave it proportional instead, or the orb
    // would swell just as hard through a murmur as through a shout.
    const samples = new Int16Array(2000)
    for (let i = 0; i < 1000; i += 1) samples[i] = Math.round(Math.sin(i) * 32767)
    for (let i = 1000; i < 2000; i += 1) samples[i] = Math.round(Math.sin(i) * 3277)
    const [loud, quiet] = bucketLevels(samples, 2) as [number, number]
    expect(loud).toBe(255)
    expect(quiet).toBeGreaterThan(0)
    expect(quiet).toBeLessThan(loud * 0.5)
  })

  it('survives silence and an empty clip without producing NaN', () => {
    expect(bucketLevels(new Int16Array(500), 4)).toEqual([0, 0, 0, 0])
    expect(bucketLevels(new Int16Array(0), 3)).toEqual([0, 0, 0])
  })
})

describe('levelAt', () => {
  it('returns 0 when there is no envelope, rather than throwing', () => {
    expect(levelAt(null, 0.5)).toBe(0)
    expect(levelAt(undefined, 0.5)).toBe(0)
    expect(levelAt([], 0.5)).toBe(0)
  })

  it('normalizes 0..255 down to 0..1', () => {
    expect(levelAt([255], 0)).toBe(1)
    expect(levelAt([0], 0)).toBe(0)
  })

  it('lands exactly on the first and last bucket at the ends', () => {
    // Not one bucket past the end: that was worth a test because the obvious
    // `progress * length` overruns the array on the final frame.
    expect(levelAt([0, 128, 255], 0)).toBeCloseTo(0)
    expect(levelAt([0, 128, 255], 1)).toBeCloseTo(1)
  })

  it('interpolates between neighbours instead of snapping', () => {
    // Halfway between bucket 0 and bucket 1 of a two-bucket envelope.
    expect(levelAt([0, 255], 0.5)).toBeCloseTo(0.5)
    expect(levelAt([0, 255], 0.25)).toBeCloseTo(0.25)
  })

  it('clamps a position outside 0..1', () => {
    expect(levelAt([10, 200], -5)).toBeCloseTo(10 / 255)
    expect(levelAt([10, 200], 9)).toBeCloseTo(200 / 255)
  })

  it('is finite across a full sweep, which is how it is actually read', () => {
    const levels = Array.from({ length: 64 }, (_, i) => (i * 4) % 256)
    for (let f = 0; f <= 1000; f += 1) {
      const v = levelAt(levels, f / 1000)
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
