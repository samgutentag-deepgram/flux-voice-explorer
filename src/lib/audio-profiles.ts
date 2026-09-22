export const EXPRESSIVITY_LEVELS = [
  { id: 'calm', label: 'Calm', value: -2 },
  { id: 'default', label: 'Tuned default', value: 0 },
  { id: 'animated', label: 'Animated', value: 2 },
] as const

export const OUTPUT_PROFILES = [
  { id: 'studio', label: 'Studio · 24 kHz', sampleRate: 24_000, encoding: 'linear16' },
  { id: 'telephony', label: 'Telephony · 8 kHz μ-law', sampleRate: 8_000, encoding: 'mulaw' },
] as const

export type ExpressivityId = (typeof EXPRESSIVITY_LEVELS)[number]['id']
export type OutputProfileId = (typeof OUTPUT_PROFILES)[number]['id']
export type AudioProfileId = `${ExpressivityId}-${OutputProfileId}`

export function audioProfileId(
  expressivity: ExpressivityId,
  output: OutputProfileId,
): AudioProfileId {
  return `${expressivity}-${output}`
}

export function trackKey(voiceId: string, profileId: AudioProfileId): string {
  return `${voiceId}:${profileId}`
}

/** Analysis for a real variant must never fall back to a different take. */
export function analysisKey(
  voiceId: string,
  profileId: AudioProfileId,
  hasVariant: boolean,
): string {
  return hasVariant ? trackKey(voiceId, profileId) : voiceId
}

export const DEFAULT_AUDIO_PROFILE = audioProfileId('default', 'studio')

export const AUDIO_PROFILE_IDS: AudioProfileId[] = EXPRESSIVITY_LEVELS.flatMap((expression) =>
  OUTPUT_PROFILES.map((output) => audioProfileId(expression.id, output.id)),
)
