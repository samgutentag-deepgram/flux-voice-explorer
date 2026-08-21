/**
 * Which orb color family each voice belongs to.
 *
 * Deepgram publishes an orb per voice, and the 36 official SVGs are committed
 * at `assets/voice-orbs/` so this mapping stays checkable. Reading them out
 * produced the one fact that shapes this whole module: **36 voices, 10 color
 * sets.** Five voices are painted in the identical orange, four more share a
 * green-and-royal, and so on. That is the source data, not a rounding we
 * applied -- see `assets/voice-orbs/README.md` for the extraction.
 *
 * So a family is the unit of color here, and this file is the only place the
 * 36 -> 10 collapse is written down. The colors themselves are NOT here: they
 * are literals, so they live in `src/styles/packs/` like every other literal in
 * the repo, as `--dg-orb-f<N>-*`. A tile carries `data-orb="<N>"` and
 * `theme.css` maps that to the semantic `--dg-orb-*` slots. Nothing in `src/`
 * outside the pack names a color, which is what `make check` enforces.
 */

/** How many families the catalog's orbs actually use. */
export const ORB_FAMILY_COUNT = 10

/**
 * Voice id -> family, 1-based to match the `--dg-orb-f1-*` token names and the
 * `[data-orb="1"]` selectors. Alphabetical, like every other voice list here.
 *
 * Extracted 2026-08-22, from the SVG fill stacks rather than by eye. Two voices
 * are alone in their family (Brooke in 4, Jack in 10); that is real, both orbs
 * carry a color combination nothing else does.
 *
 * Exported so the tests can check it against `assets/voice-orbs/` in both
 * directions. `orbFamily` is what application code should use.
 */
export const ORB_FAMILY_BY_VOICE: Readonly<Record<string, number>> = {
  'flux-alexis-en': 1,
  'flux-marcelo-en': 1,
  'flux-sean-en': 1,
  'flux-sienna-en': 1,
  'flux-tanner-en': 1,

  'flux-bree-en': 2,
  'flux-maeve-en': 2,
  'flux-meena-en': 2,

  'flux-brittany-en': 3,
  'flux-bruce-en': 3,
  'flux-priya-en': 3,
  'flux-wes-en': 3,

  'flux-brooke-en': 4,

  'flux-cliff-en': 5,
  'flux-conor-en': 5,
  'flux-drew-en': 5,
  'flux-marcus-en': 5,

  'flux-cole-en': 6,
  'flux-kit-en': 6,
  'flux-miles-en': 6,
  'flux-wade-en': 6,

  'flux-colin-en': 7,
  'flux-elise-en': 7,
  'flux-kai-en': 7,
  'flux-naveen-en': 7,
  'flux-sharon-en': 7,

  'flux-donovan-en': 8,
  'flux-gemma-en': 8,
  'flux-haley-en': 8,
  'flux-paige-en': 8,
  'flux-rufus-en': 8,

  'flux-hannah-en': 9,
  'flux-heather-en': 9,
  'flux-kelsey-en': 9,
  'flux-meghan-en': 9,

  'flux-jack-en': 10,
}

/**
 * The family for a voice, or `null` when we have no orb for it.
 *
 * `null` is a real case, not defensive padding: the catalog comes from the live
 * `/v2/models` list, so a voice Deepgram ships tomorrow will render here before
 * anyone exports its orb.
 *
 * Callers leave `data-orb` off the element entirely for it, which falls back to
 * the `:root` defaults in `theme.css` -- a new voice looks deliberately
 * unbranded rather than invisible. Nothing above a tile carries `data-orb`, so
 * there is nothing for an attribute-less element to inherit by mistake.
 */
export function orbFamily(voiceId: string): number | null {
  return ORB_FAMILY_BY_VOICE[voiceId] ?? null
}
