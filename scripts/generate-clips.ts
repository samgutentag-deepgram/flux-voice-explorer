/**
 * Render the audition set: one clip per Flux TTS voice, all reading CLIP_TEXT.
 *
 *   pnpm clips                 render anything missing
 *   pnpm clips -- --force      re-render everything
 *   pnpm clips -- --only kit,bree
 *   pnpm clips -- --list       resolve the catalog and print it, render nothing
 *
 * Two API calls are involved and they answer different questions:
 *   GET  /v2/models   what voices exist right now (authoritative, not a table)
 *   POST /v2/speak    render one voice (stateless, one call per voice)
 *
 * It has to be /v2/models. Verified 2026-08-20: /v1/models returns 102 tts
 * entries and NOT ONE of them is Flux -- every architecture there is aura or
 * aura-2. /v2/models returns 36, all `flux-tts`. Neither endpoint errors on the
 * wrong version, so asking v1 for Flux voices silently answers zero.
 *
 * Audio path: we ask for raw headerless linear16 and transcode with ffmpeg
 * rather than asking the API for MP3. Two reasons. `container=none` means the
 * response body IS the PCM buffer, so duration is exact arithmetic on the byte
 * count instead of a probe, and it sidesteps the batch `container=wav`
 * placeholder-header bug (a ~2 GB declared data length) that hn-radio hit.
 * MP3 at 64 kbit mono takes a 2-minute clip from ~5.8 MB to ~1 MB, which is
 * what makes a 36-tile page loadable at all.
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CLIP_SCRIPT, CLIP_SCRIPT_HASH, CLIP_TEXT } from '../src/lib/clip-script.ts'
import { FALLBACK_CATALOG, displayName, parseCatalogRow } from './fallback-catalog.ts'
import { alignClips } from './align-clips.ts'
import { computePeaks } from './peaks.ts'
import { CLIPS_DIR, CONCURRENCY, loadKey, mapLimit, readJson, runFfmpeg } from './shared.ts'
import type { Manifest, Voice } from '../src/lib/voices.ts'

const SAMPLE_RATE = 24_000
const ENCODING = 'linear16'
const MP3_BITRATE = '64k'
const MODELS_ENDPOINT = '/v2/models'
const MAX_RETRIES = 4

type Args = { force: boolean; list: boolean; only: string[] }

/** Accepts `--only a,b` and `--only=a,b`, which is the whole grammar. */
function parseArgs(argv: string[]): Args {
  const flag = argv.findIndex((a) => a === '--only' || a.startsWith('--only='))
  const raw =
    flag === -1
      ? ''
      : (argv[flag]!.includes('=') ? argv[flag]!.split('=')[1] : argv[flag + 1]) ?? ''
  return {
    force: argv.includes('--force'),
    list: argv.includes('--list'),
    only: raw.startsWith('-') ? [] : raw.split(',').map((s) => s.trim()).filter(Boolean),
  }
}

// --- catalog ---------------------------------------------------------------

type CatalogVoice = Omit<Voice, 'clip' | 'duration' | 'bytes'>
type Catalog = { source: 'api' | 'fallback'; endpoint: string; voices: CatalogVoice[] }

const GENDER_TAGS = /^(feminine|masculine|female|male|non-binary)$/i

/**
 * The live model list is the only honest answer to "how many voices are there".
 *
 * Field mapping, verified against a real response 2026-08-20:
 *   canonical_name        -> id            (`flux-alexis-en`)
 *   metadata.display_name -> name          (`Alexis`)
 *   metadata.accent/age   -> accent, age
 *   metadata.tags[]       -> gender word, then SEARCH-ONLY character words
 *   metadata.use_cases[]  -> useCases
 *
 * Displayed characteristics come from the published docs table, not from
 * `metadata.tags`. The API returns a superset -- six or so tags per voice
 * against the docs page's three -- and the extras include words the docs
 * deliberately leave off: it tags Brittany `robotic`, Donovan `angry`, and Bree
 * `confused`. Those are real model metadata but they are not how Deepgram
 * describes its own GA voices, and this is a public demo. The full tag list is
 * still carried in `searchTerms` so filtering finds everything.
 *
 * Everything is read defensively because this shape has moved before. An
 * unmappable field degrades to the voice id rather than throwing away a whole
 * catalog over one bad row.
 */
async function fetchCatalog(key: string, host: string): Promise<Catalog> {
  try {
    const res = await fetch(`https://${host}${MODELS_ENDPOINT}`, {
      headers: { Authorization: `Token ${key}` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`)
    const body = (await res.json()) as Record<string, unknown>
    const tts = Array.isArray(body.tts) ? (body.tts as Record<string, unknown>[]) : []
    const flux = tts.filter((m) => String(m.canonical_name ?? m.name ?? '').startsWith('flux-'))
    if (flux.length === 0) {
      throw new Error(
        `no flux-* entries in tts[] (${tts.length} tts models, keys: ${Object.keys(body)})`,
      )
    }

    return {
      source: 'api',
      endpoint: MODELS_ENDPOINT,
      voices: flux
        .map((m): CatalogVoice => {
          const id = String(m.canonical_name ?? m.name)
          const meta = (m.metadata ?? {}) as Record<string, unknown>
          const tags = (Array.isArray(meta.tags) ? meta.tags : []).map(String)
          const gender = tags.find((t) => GENDER_TAGS.test(t)) ?? ''
          const published = FALLBACK_CATALOG[id]
          return {
            id,
            name: String(meta.display_name ?? '') || displayName(id),
            accent: String(meta.accent ?? ''),
            gender: /^(f|fem)/i.test(gender) ? 'F' : /^(m|mas)/i.test(gender) ? 'M' : '',
            age: String(meta.age ?? ''),
            // Docs wording when we have it, API tags otherwise (a voice newer
            // than the bundled table). reportCatalogDrift says when that happens.
            characteristics: published
              ? parseCatalogRow(published).characteristics
              : tags.filter((t) => !GENDER_TAGS.test(t)),
            searchTerms: tags.filter((t) => !GENDER_TAGS.test(t)),
            useCases: (Array.isArray(meta.use_cases) ? meta.use_cases : []).map(String),
          }
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
    }
  } catch (err) {
    console.warn(`! ${MODELS_ENDPOINT} unusable (${(err as Error).message}); using the bundled table.`)
    return {
      source: 'fallback',
      endpoint: 'scripts/fallback-catalog.ts',
      voices: Object.entries(FALLBACK_CATALOG).map(([id, row]) => ({
        id,
        name: displayName(id),
        ...parseCatalogRow(row),
        searchTerms: parseCatalogRow(row).characteristics,
        useCases: [],
      })),
    }
  }
}

/** Say out loud where the live catalog and the bundled table disagree. */
function reportCatalogDrift(catalog: Catalog): void {
  if (catalog.source !== 'api') return
  const live = new Set(catalog.voices.map((v) => v.id))
  const table = new Set(Object.keys(FALLBACK_CATALOG))
  const added = [...live].filter((id) => !table.has(id))
  const gone = [...table].filter((id) => !live.has(id))
  console.log(
    `  catalog: ${live.size} flux voices live via ${catalog.endpoint}, ` +
      `${table.size} in the bundled table`,
  )
  if (added.length) console.log(`  new since the table was written: ${added.join(', ')}`)
  if (gone.length) console.log(`  in the table but NOT live: ${gone.join(', ')}`)
  if (!added.length && !gone.length) console.log('  bundled table matches the live catalog')
}

// --- render ----------------------------------------------------------------

async function speak(voiceId: string, key: string, host: string): Promise<Buffer> {
  const query = new URLSearchParams({
    model: voiceId,
    encoding: ENCODING,
    container: 'none',
    sample_rate: String(SAMPLE_RATE),
  })
  let lastError = ''
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(`https://${host}/v2/speak?${query}`, {
        method: 'POST',
        headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: CLIP_TEXT }),
      })
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`
        await new Promise((r) => setTimeout(r, 2 ** attempt * 500))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      let pcm = Buffer.from(await res.arrayBuffer())
      // Guard: strip a WAV header if the server sends one despite container=none.
      if (pcm.subarray(0, 4).toString() === 'RIFF') pcm = pcm.subarray(44)
      if (pcm.length === 0) throw new Error('empty audio body')
      return pcm
    } catch (err) {
      lastError = (err as Error).message
      if (attempt === MAX_RETRIES) break
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500))
    }
  }
  throw new Error(`${voiceId}: ${lastError}`)
}

async function toMp3(pcm: Buffer, outPath: string): Promise<void> {
  await runFfmpeg(
    [
      '-y', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0',
      '-codec:a', 'libmp3lame', '-b:a', MP3_BITRATE, outPath,
    ],
    pcm,
  )
}

// --- main ------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const { key, host } = loadKey()
  const scriptHash = CLIP_SCRIPT_HASH

  console.log(`Flux voice explorer, clip generator`)
  console.log(`  host: ${host}`)
  console.log(`  script: ${CLIP_SCRIPT.length} sections, ${CLIP_TEXT.length} chars, #${scriptHash}`)

  const catalog = await fetchCatalog(key, host)
  reportCatalogDrift(catalog)

  let wanted = catalog.voices
  if (args.only.length) {
    const needles = args.only.map((s) => s.toLowerCase())
    wanted = wanted.filter((v) => needles.some((n) => v.id.includes(n)))
    console.log(`  --only matched ${wanted.length}: ${wanted.map((v) => v.id).join(', ')}`)
  }

  if (args.list) {
    for (const v of wanted) {
      console.log(
        `  ${v.id.padEnd(22)} ${v.name.padEnd(10)} ` +
          `${`${v.accent} ${v.gender} ${v.age}`.padEnd(28)} ` +
          `${v.characteristics.join(', ').padEnd(46)} | ${v.useCases.join(', ')}`,
      )
    }
    console.log(`\n${wanted.length} voices. Nothing rendered (--list).`)
    return
  }

  await mkdir(CLIPS_DIR, { recursive: true })
  const existing = new Set(await readdir(CLIPS_DIR).catch(() => []))

  let done = 0
  const failures: string[] = []
  const rendered = await mapLimit(wanted, CONCURRENCY, async (voice) => {
    const file = `${voice.id}.mp3`
    const outPath = path.join(CLIPS_DIR, file)
    const cached = !args.force && existing.has(file)

    try {
      let durationSeconds: number
      if (cached) {
        durationSeconds = await mp3DurationFromSidecar(outPath)
      } else {
        const pcm = await speak(voice.id, key, host)
        // 16-bit mono: two bytes per sample.
        durationSeconds = pcm.length / 2 / SAMPLE_RATE
        await toMp3(pcm, outPath)
        await writeFile(`${outPath}.json`, JSON.stringify({ durationSeconds }))
      }
      const { size } = await stat(outPath)
      done += 1
      console.log(
        `  [${String(done).padStart(2)}/${wanted.length}] ${cached ? 'cached' : 'rendered'} ` +
          `${voice.id.padEnd(22)} ${durationSeconds.toFixed(1)}s ${(size / 1024).toFixed(0)}KB`,
      )
      return { ...voice, clip: `/clips/${file}`, duration: durationSeconds, bytes: size } as Voice
    } catch (err) {
      failures.push(`${voice.id}: ${(err as Error).message}`)
      console.error(`  [--/${wanted.length}] FAILED ${voice.id}: ${(err as Error).message}`)
      return null
    }
  })

  const voices = rendered.filter((v): v is Voice => v !== null)
  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    scriptHash,
    catalogSource: catalog.source,
    catalogEndpoint: catalog.endpoint,
    model: 'flux',
    encoding: `mp3 ${MP3_BITRATE}`,
    sampleRate: SAMPLE_RATE,
    voices,
  }

  // A partial run must not clobber a good manifest with a shorter one.
  const manifestPath = path.join(CLIPS_DIR, 'manifest.json')
  if (args.only.length) {
    const prior = await readJson<Manifest>(manifestPath)
    // Only merge rows that belong to the SAME script. A stale manifest merged
    // with new voices would mix two scripts in one file.
    if (prior && prior.scriptHash === scriptHash) {
      const merged = new Map(prior.voices.map((v) => [v.id, v]))
      for (const v of voices) merged.set(v.id, v)
      manifest.voices = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id))
    }
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const totalMb = manifest.voices.reduce((n, v) => n + v.bytes, 0) / 1024 / 1024
  const durations = manifest.voices.map((v) => v.duration)
  console.log(
    `\n${manifest.voices.length} voices in manifest.json, ${totalMb.toFixed(1)} MB total\n` +
      `  pace spread: ${Math.min(...durations).toFixed(1)}s fastest, ` +
      `${Math.max(...durations).toFixed(1)}s slowest`,
  )
  if (failures.length) {
    console.error(`\n${failures.length} failed:\n  ${failures.join('\n  ')}`)
    process.exitCode = 1
  }

  // Rendering without aligning leaves the ticker on the syllable estimate,
  // which is wrong by up to twenty words. Chain it so that cannot be forgotten,
  // and pass the voices we just rendered rather than re-reading the manifest and
  // re-parsing argv -- `--force` means "re-render" here and "re-align" there.
  console.log('\nAligning word timings...')
  // Only what this run actually rendered. Handing over the whole manifest with
  // `--force` meant `--only bree` re-rendered one clip and then spent 35
  // unnecessary STT calls re-aligning everything else. Both chained steps get
  // the same subset, so they agree on what this run covered.
  const renderedThisRun = args.only.length ? voices : manifest.voices
  await alignClips({ voices: renderedThisRun, force: args.force, key, host })

  // Local, free, and required by the waveform on the focused tile.
  console.log('\nComputing waveforms...')
  await computePeaks({ voices: renderedThisRun, force: args.force })
}

/** Duration written alongside a cached clip, so a re-run needs no ffprobe. */
async function mp3DurationFromSidecar(mp3Path: string): Promise<number> {
  const raw = await readFile(`${mp3Path}.json`, 'utf8').catch(() => null)
  if (raw) {
    const parsed = JSON.parse(raw) as { durationSeconds?: number }
    if (typeof parsed.durationSeconds === 'number') return parsed.durationSeconds
  }
  // Cached clip with no sidecar (hand-copied, or written by an older run).
  // Estimate from the bitrate rather than failing the whole run; the browser
  // reports the real duration on load and the player prefers that.
  const { size } = await stat(mp3Path)
  return (size * 8) / (Number.parseInt(MP3_BITRATE, 10) * 1000)
}

await main()
