# Style pack

Active pack: **`deepgram-2026`** (`src/styles/packs/deepgram-2026.css`).

Deepgram brand starter kit 2026: off-black glass surfaces, fuchsia `#E042FF`
as the one accent (live state, focus, primary action), Work Sans for display
and body, Azeret Mono for labels and small CTAs. The ten voice-orb families
keep their official voice mapping, repainted in the kit's supporting colors.
Values the kit does not give (radii, grey ramp, deep shades) are marked
INFERRED in the pack.

The wordmark is `src/components/DeepgramLogo.tsx`, verbatim paths from
developers.deepgram.com with `currentColor` fill, so it carries no literal.

Previous pack: `flux-2026` (green accent, Space Grotesk/Inter/Fira Code),
kept in `packs/` for comparison.

## The seal

Literal colors, fonts, and brand radii live **only** in `src/styles/packs/`.
Everywhere else uses `var(--dg-*)`. `make check` greps for violations and fails
the build, so this is enforced rather than documented.

`src/styles/theme.css` imports exactly one pack. That single `@import` line is
the whole rebrand surface.

## To rebrand

1. `cp src/styles/packs/deepgram-2026.css src/styles/packs/<name>-<year>.css`
2. Change the values. Keep every token name identical.
3. Repoint the one `@import` in `theme.css`.
4. Update this file.
5. `make check` and look at it. Nothing outside `packs/` should have needed a
   change; if it did, that is the leak.

## Note on @deepgram/ui

This demo does not use `@deepgram/ui` — there is no agent session and no voice
widget, just a grid of `<audio>` tiles. The `--dg-color-*` bridge block in
`theme.css` is kept anyway, unmodified, so dropping a `@deepgram/ui` component
in later is a one-line import rather than a theming job.
