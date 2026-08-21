/**
 * Align a transcript back onto the script it was read from.
 *
 * Why this exists: the ticker needs to know when each word is spoken, and batch
 * `/v2/speak` returns audio and nothing else. The syllable estimate that used to
 * drive the ticker was measured against real timings and is wrong by up to 8.8
 * seconds -- about twenty words -- because it cannot know that Flux reads a line
 * of acronyms and decimals far slower per syllable than it reads short closing
 * sentences. No amount of retuning the pause constants fixes that; the
 * information is not in the text.
 *
 * So the generator sends each rendered clip through STT, which returns real word
 * timings, and this aligns those words back to the script. Alignment is needed
 * rather than a straight zip because the two token streams do not match: STT
 * spells "429" as "four twenty nine", hears "/v2/speak" as loose words, and
 * occasionally drops or splits one. Needleman-Wunsch handles the insertions and
 * deletions; script words with no match get interpolated between their matched
 * neighbours.
 *
 * Typical result on this script: 94% of words matched directly.
 */

export type SttWord = { word: string; start: number; end: number }

export type AlignResult = {
  /** Normalized start position (0..1) per SCRIPT word index. */
  starts: number[]
  /** How many script words matched a transcript word outright. */
  matched: number
  total: number
}

const MATCH = 2
const MISMATCH = -1
const GAP = -1

function normalize(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Needleman-Wunsch global alignment. Script words are rows, transcript words
 * columns. Returns, per script word, the index of the transcript word it matched
 * or null.
 *
 * O(n*m) at 250 x 260 is 65k cells per voice. Fine for a build step; do not put
 * this in a request path.
 */
export function matchIndices(scriptWords: string[], sttWords: string[]): (number | null)[] {
  const a = scriptWords.map(normalize)
  const b = sttWords.map(normalize)
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return new Array(n).fill(null)

  /**
   * Empty never equals empty. A punctuation-only token normalizes to '', and
   * treating two of those as a match plants a bogus timing anchor AND inflates
   * the matched/total rate that MIN_MATCH_RATE gates on -- so a bad alignment
   * could report itself as a good one.
   */
  const same = (x: string | undefined, y: string | undefined) => x !== '' && x === y

  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = 1; i <= n; i += 1) dp[i]![0] = i * GAP
  for (let j = 1; j <= m; j += 1) dp[0]![j] = j * GAP
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diag = dp[i - 1]![j - 1]! + (same(a[i - 1], b[j - 1]) ? MATCH : MISMATCH)
      dp[i]![j] = Math.max(diag, dp[i - 1]![j]! + GAP, dp[i]![j - 1]! + GAP)
    }
  }

  const map: (number | null)[] = new Array(n).fill(null)
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const diag = dp[i - 1]![j - 1]! + (same(a[i - 1], b[j - 1]) ? MATCH : MISMATCH)
    if (dp[i]![j] === diag) {
      // Only record an actual match. A mismatch on the diagonal means the two
      // words were paired for alignment purposes but are not the same word, so
      // its timing is not trustworthy; let interpolation cover it.
      if (same(a[i - 1], b[j - 1])) map[i - 1] = j - 1
      i -= 1
      j -= 1
    } else if (dp[i]![j] === dp[i - 1]![j]! + GAP) {
      i -= 1
    } else {
      j -= 1
    }
  }
  return map
}

/**
 * Real normalized start position per script word.
 *
 * `duration` is the clip length, so positions come out on the same 0..1 scale
 * the playhead uses and the ticker needs no per-voice conversion.
 */
export function alignWords(
  scriptWords: string[],
  sttWords: SttWord[],
  duration: number,
): AlignResult {
  const n = scriptWords.length
  const total = duration > 0 ? duration : 1
  if (n === 0) return { starts: [], matched: 0, total: 0 }

  const map = matchIndices(
    scriptWords,
    sttWords.map((w) => w.word),
  )
  const starts: (number | null)[] = map.map((j) =>
    j === null ? null : (sttWords[j]?.start ?? 0) / total,
  )

  // Anchor the ends so interpolation always has two sides to work from.
  if (starts[0] === null) starts[0] = 0
  if (starts[n - 1] === null) starts[n - 1] = 1

  for (let k = 0; k < n; k += 1) {
    if (starts[k] !== null) continue
    let before = k - 1
    while (before >= 0 && starts[before] === null) before -= 1
    let after = k + 1
    while (after < n && starts[after] === null) after += 1
    const lo = starts[before] ?? 0
    const hi = starts[after] ?? 1
    starts[k] = lo + (hi - lo) * ((k - before) / (after - before))
  }

  // Monotonic by construction, but STT can emit a word whose start precedes the
  // previous one. Clamp rather than let the ticker scroll backwards.
  let last = 0
  const clean = (starts as number[]).map((v) => {
    const value = Math.min(Math.max(v, last), 1)
    last = value
    return value
  })

  return {
    starts: clean,
    matched: map.filter((x) => x !== null).length,
    total: n,
  }
}
