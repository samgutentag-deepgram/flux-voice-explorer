/**
 * Shared plumbing for the generator scripts.
 *
 * These lived in duplicate: `loadKey`, `mapLimit`, `CLIPS_DIR` and the script
 * hash were copy-pasted between generate-clips and align-clips, and the two
 * copies of `loadKey` had already drifted -- one printed the "copy sample.env"
 * hint and the other did not, so the setup guidance you got depended on which
 * script you happened to run first.
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const CLIPS_DIR = path.resolve(import.meta.dirname, '..', 'public', 'clips')
/**
 * Fan-out for every generator: HTTP to Deepgram in two of them, local ffmpeg in
 * the third. One number because the machine and the rate limiter both tolerate
 * four, not because the two kinds of work are the same.
 */
export const CONCURRENCY = 4

export type Credentials = { key: string; host: string }

export function loadKey(): Credentials {
  try {
    process.loadEnvFile('.env')
  } catch {
    // No .env is fine if the key is already exported.
  }
  const key = process.env.DEEPGRAM_API_KEY?.trim()
  if (!key) {
    console.error(
      'DEEPGRAM_API_KEY is empty.\n' +
        'Paste a key into .env (copy sample.env if it is missing) and run this again.\n' +
        'Keys: https://console.deepgram.com',
    )
    process.exit(1)
  }
  return { key, host: process.env.DEEPGRAM_API_HOST?.trim() || 'api.deepgram.com' }
}

/** Bounded parallel map. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await fn(items[index]!)
      }
    }),
  )
  return results
}

/** Read and parse a JSON file, or null if it is missing or malformed. */
export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

/**
 * Run ffmpeg and return whatever it wrote to stdout.
 *
 * One wrapper, because the message that tells a user ffmpeg is not installed
 * should exist once. The two copies this replaced had already drifted apart in
 * how much stderr they quoted.
 */
export function runFfmpeg(args: string[], stdin?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args])
    const chunks: Buffer[] = []
    let stderr = ''
    ff.stdout.on('data', (c: Buffer) => chunks.push(c))
    ff.stderr.on('data', (c) => (stderr += c))
    ff.on('error', (e) => reject(new Error(`ffmpeg not runnable: ${e.message}`)))
    ff.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(0, 300)}`)),
    )
    if (stdin) {
      ff.stdin.on('error', () => {})
      ff.stdin.end(stdin)
    }
  })
}

export type Sidecar<T> = { scriptHash: string; voices: Record<string, T> }

/**
 * Decide what a generator can reuse from its previous output.
 *
 * The rule this exists to state ONCE: `--force` means re-do, never discard. A
 * force run that rebuilt from scratch let one network blip permanently drop a
 * good row and silently downgrade that voice. So `carried` is what stays in the
 * output file regardless, and `existing` is only what lets a voice be skipped.
 */
export async function carryForward<T>(
  file: string,
  isFresh: (prior: Sidecar<T> & Record<string, unknown>) => boolean,
  force: boolean,
): Promise<{ carried: Record<string, T>; existing: Record<string, T> }> {
  const prior = await readJson<Sidecar<T> & Record<string, unknown>>(file)
  const carried = prior && isFresh(prior) ? prior.voices : {}
  return { carried, existing: force ? {} : carried }
}
