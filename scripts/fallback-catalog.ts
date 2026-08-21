/**
 * Last-resort voice catalog, transcribed from the published Flux TTS voices
 * page: https://developers.deepgram.com/docs/flux-tts/voices
 *
 * This exists only so `pnpm clips` still does something useful when
 * `GET /v1/models` is unreachable or returns a shape we do not recognize. The
 * live model list is authoritative; if the two disagree the generator says so
 * loudly rather than quietly preferring the table, because a hand-maintained
 * catalog is exactly the thing that goes stale without anyone noticing.
 *
 * Format per row: accent, gender, age band, then the character words.
 */
export const FALLBACK_CATALOG: Record<string, string> = {
  'flux-alexis-en': 'American F Adult, Clear, professional, calm',
  'flux-bree-en': 'American F Mature, Friendly, sweet, kind',
  'flux-brittany-en': 'American F Mature, Confident, kind, soft',
  'flux-brooke-en': 'American F Young, Friendly, intelligent, fast',
  'flux-bruce-en': 'American M Adult, Friendly, kind, natural',
  'flux-cliff-en': 'American M Mature, Deep, confident, calm',
  'flux-cole-en': 'American M Young, Friendly, clear, interesting',
  'flux-colin-en': 'British M Adult, Warm, friendly, trustworthy',
  'flux-conor-en': 'British M Mature, Confident, deep, friendly',
  'flux-donovan-en': 'American M Adult, Professional, calm, thoughtful',
  'flux-drew-en': 'American M Adult, Confident, relaxed, soft',
  'flux-elise-en': 'American F Adult, Clear, professional, calm',
  'flux-gemma-en': 'British F Young, Friendly, kind, approachable',
  'flux-haley-en': 'American F Young Adult, Clear, professional, caring',
  'flux-hannah-en': 'American F Young, Clear, confident, thoughtful',
  'flux-heather-en': 'American F Young, Clear, engaging, energetic',
  'flux-jack-en': 'British M Adult, Confident, thoughtful, friendly',
  'flux-kai-en': 'Singaporean M Young Adult, Clear, calm, professional',
  'flux-kelsey-en': 'American F Young Adult, Clear, professional, caring',
  'flux-kit-en': 'British M Young Adult, Friendly, energetic, thoughtful',
  'flux-maeve-en': 'Irish F Adult, Friendly, energetic, confident',
  'flux-marcelo-en': 'Filipino M Young Adult, Clear, calm, professional',
  'flux-marcus-en': 'American M Adult, Friendly, helpful, smooth',
  'flux-meena-en': 'Indian F Adult, Empathetic, professional, calm',
  'flux-meghan-en': 'American F Adult, Friendly, nice, energetic',
  'flux-miles-en': 'American M Adult, Clear, calm, professional',
  'flux-naveen-en': 'Indian M Adult, Clear, professional, knowledgeable',
  'flux-paige-en': 'American F Young Adult, Clear, professional, calm',
  'flux-priya-en': 'Indian F Adult, Confident, empathetic, professional',
  'flux-rufus-en': 'British M Adult, Friendly, confident, intelligent',
  'flux-sean-en': 'British M Mature, Friendly, kind, caring',
  'flux-sharon-en': 'Australian F Young, Formal, calm, relaxed',
  'flux-sienna-en': 'American F Young Adult, Clear, professional, calm',
  'flux-tanner-en': 'British M Adult, Professional, calm, confident',
  'flux-wade-en': 'American M Adult, Warm, confident, clear',
  'flux-wes-en': 'American M Adult, Thoughtful, friendly, warm',
}

const AGE_BANDS = ['Young Adult', 'Young', 'Adult', 'Mature'] as const

/** Turn `"American F Young Adult, Clear, professional, calm"` into fields. */
export function parseCatalogRow(row: string): {
  accent: string
  gender: string
  age: string
  characteristics: string[]
} {
  const [head = '', ...rest] = row.split(',').map((s) => s.trim())
  const age = AGE_BANDS.find((band) => head.endsWith(band)) ?? ''
  const withoutAge = age ? head.slice(0, -age.length).trim() : head
  const parts = withoutAge.split(/\s+/).filter(Boolean)
  const gender = parts.length > 1 && /^[FM]$/.test(parts.at(-1)!) ? parts.pop()! : ''
  return { accent: parts.join(' '), gender, age, characteristics: rest }
}

export function displayName(voiceId: string): string {
  const middle = voiceId.replace(/^flux-/, '').replace(/-[a-z]{2}$/, '')
  return middle
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
