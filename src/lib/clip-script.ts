/**
 * The audition script. Every voice reads exactly this, which is the whole point:
 * the only variable across tiles is the voice.
 *
 * Written to exercise the things that actually separate one TTS voice from
 * another rather than to read nicely. Each section leans on a different
 * failure mode, so you can A/B the same beat across two voices and hear where
 * they diverge instead of guessing from a single friendly sentence.
 *
 * Changing this text invalidates every rendered clip. `pnpm clips` hashes it
 * into the manifest so a stale clip set is detectable rather than silent.
 */

export type ScriptSection = {
  id: string
  /** What this section is testing, shown in the transport bar. */
  label: string
  text: string
}

export const CLIP_SCRIPT: ScriptSection[] = [
  {
    id: 'neutral',
    label: 'Neutral prose',
    text:
      'Every voice in this catalog is reading the same script, so the only thing changing ' +
      'is the voice itself. That makes the comparison honest. If one of these sounds warmer ' +
      'than another, it is not because the writing flattered it. It is the voice.',
  },
  {
    id: 'question-list',
    label: 'Question and list',
    text:
      'So which one do you pick? It depends on three things: the accent, the age the voice ' +
      'reads as, and how much energy it brings to a flat sentence. Does it lift at a question ' +
      'mark? Does it slow down for a list, or race through it? Listen for the comma. That is ' +
      'usually where a synthetic voice gives itself away.',
  },
  {
    id: 'technical',
    label: 'Numbers and acronyms',
    text:
      'Flux TTS returns twenty four kilohertz linear sixteen PCM from the /v2/speak endpoint. ' +
      'A two minute clip is about 5.8 megabytes raw, or roughly 1 megabyte as a 64 kilobit ' +
      'MP3. The API, the SDK, the CLI, and the CI job all agree on that number. HTTP 429 means ' +
      'slow down; HTTP 401 means your key is wrong.',
  },
  {
    id: 'long-clause',
    label: 'Long clause',
    text:
      'This next sentence runs long on purpose, because the interesting question is not whether ' +
      'a voice can read eight words cleanly but whether it can carry a thought across a comma, ' +
      'and then another comma, and then a subordinate clause that arrives late and changes the ' +
      'emphasis of everything before it, without either running out of breath or resetting to a ' +
      'neutral pitch the moment the clause boundary passes.',
  },
  {
    id: 'close',
    label: 'Close',
    text:
      'Then it stops. Short line. Then a shorter one. That is it. Same words, every tile. ' +
      'Different voice.',
  },
]

/** What actually goes to the API: one string, sections joined by a paragraph break. */
export const CLIP_TEXT = CLIP_SCRIPT.map((s) => s.text).join('\n\n')

export const CLIP_WORDS = CLIP_TEXT.split(/\s+/).filter(Boolean)

export const CLIP_WORD_COUNT = CLIP_WORDS.length

/**
 * Identity of the script text, shared by the generator, the aligner, and the
 * browser. Editing CLIP_TEXT changes this, which is how stale clips and stale
 * word timings are detected.
 *
 * FNV-1a rather than SHA-256 on purpose: the same function has to run in a Node
 * script and in the browser, and `node:crypto` does not. This is a change
 * detector, not a security boundary.
 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export const CLIP_SCRIPT_HASH = fnv1a(CLIP_TEXT)

/**
 * Word index each section starts at.
 *
 * Lives here, next to `CLIP_WORDS`, because it indexes into exactly that
 * tokenization -- the same one `timings.json` is built against. Computed from a
 * second copy of the split rule, every section marker would silently land on the
 * wrong word the day the two diverged.
 */
export const SECTION_STARTS: { id: string; label: string; word: number }[] = (() => {
  let cursor = 0
  return CLIP_SCRIPT.map((section) => {
    const word = cursor
    cursor += section.text.split(/\s+/).filter(Boolean).length
    return { id: section.id, label: section.label, word }
  })
})()
