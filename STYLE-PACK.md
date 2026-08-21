# Style pack

Active pack: **`flux-2026`** (`src/styles/packs/flux-2026.css`).

Dark-first, near-black glass surfaces, one electric green accent, hairline
white-alpha borders. Values observed from the app behind
<https://talk.deepgram.com/>.

## The seal

Literal colors, fonts, and brand radii live **only** in `src/styles/packs/`.
Everywhere else uses `var(--dg-*)`. `make check` greps for violations and fails
the build, so this is enforced rather than documented.

`src/styles/theme.css` imports exactly one pack. That single `@import` line is
the whole rebrand surface.

## To rebrand

1. `cp src/styles/packs/flux-2026.css src/styles/packs/<name>-<year>.css`
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
