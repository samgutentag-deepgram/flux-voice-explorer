# AGENTS.md

## What this is

A single-page explorer for the Deepgram Flux TTS voice catalog. Every voice is
pre-rendered reading one identical script; the UI puts them on a grid and shares
one normalized playhead across all of them, so hovering a tile plays that voice
at the current position in the script.

Read `README.md` for the user-facing story. This file is the parts that a later
edit is most likely to get wrong.

## Stack, as resolved 2026-08-20

| Layer | Value |
|---|---|
| Framework | React 19.2.8 + Vite 8.2.2 |
| Language | TypeScript 7.0.2, strict |
| Backend | Express 5.2.1, thin |
| Tests | Vitest 4.1.11 |
| Generator | tsx 4.23.12, raw `fetch`, ffmpeg |
| Node | 22 LTS (`.nvmrc`) |
| Package manager | pnpm 11.17.0 |
| Ports | Vite dev 8080, API 8081, `/api` proxied. One port in production |
| Deploy | Fly.io, single app, `dg-devrel-flux-voice-explorer` |

Every version above came from `npm view <pkg> version`, not from memory. Do the
same before changing one.

## Deliberate divergences from the create-deepgram-demo skill

These are choices, not oversights. Do not "fix" them without reading why.

- **No `@deepgram/react`, no `@deepgram/agents`.** There is no agent session and
  no browser-held socket. Those packages solve reconnect, keep-alive, and audio
  buffering for a live voice agent; none of that exists here.
- **No `@deepgram/ui`.** The UI is a grid of `<audio>` tiles and a transport
  bar. The `--dg-color-*` bridge block in `theme.css` is kept anyway, unmodified,
  so adding a component later is one import rather than a theming job.
- **No API routes at all beyond `/api/health`.** The browser plays static files,
  so there is no token grant and nothing to proxy. The server holds no secrets
  and a deployed copy needs no `fly secrets` -- the clips are baked into the
  image. Only the generator scripts read `DEEPGRAM_API_KEY`.
- **No Deepgram npm SDK.** The published SDK exposes Speak V2 only as a
  streaming WebSocket client, with no batch REST method. Deepgram documents Flux
  batch as a raw request. Raw `fetch` is the conformant path here; the SDK would
  apply the day a streaming render path exists.

## What not to change

> Literal colors, fonts, and radii live only in `src/styles/packs/`. Everywhere
> else uses `var(--dg-*)`. `make check` enforces this.

- **Word timings come from STT, not from the syllable estimate.**
  `scripts/align-clips.ts` transcribes each clip and aligns it to the script, and
  `public/clips/timings.json` holds the real position of every word for every
  voice. The estimator in `src/lib/word-timeline.ts` is a fallback for before
  that has run; it is out by up to 8.9 seconds, 21 words. Do not
  try to fix it by retuning the pause constants -- it is ahead in the first half
  of the script and behind in the second because Flux reads acronyms and
  decimals far slower per syllable than short sentences, and that is not
  knowable from the text. Run the alignment.
- **The playhead is normalized (0..1 through the script), not seconds.** The
  clips are different lengths on purpose — same words, different pace — so a
  seconds-based clock would drift against whatever you are hearing. See the
  header comment in `src/lib/sync-player.ts` before touching it.
- **Only the focused element plays.** Keeping all ~36 playing and muted was the
  first design; the comment in `sync-player.ts` explains why it buys nothing.
- **The auto-pause hangs off leaving a TILE, not off leaving the grid.** It was
  a `pointerleave` on `.grid-wrap` first, and that container also holds the
  gutters between tiles, the grid's own padding, and the empty-filter line. So
  sliding off a tile into a gap was not "off a tile": the audio ducked and the
  playhead kept running, and the ticker scrolled on with nothing behind it until
  you left the grid entirely. `VoiceTile` now reports the leave and `handleFocus`
  in `App.tsx` owns the decision. Do not move it back up to the container to
  save a prop, and keep the `pointerType === 'mouse'` guard: on touch,
  `pointerleave` fires when the finger lifts.
- **The catalog is not hardcoded, and the endpoint is `/v2/models`.**
  `scripts/generate-clips.ts` asks the API what exists.
  `scripts/fallback-catalog.ts` is a last resort for when that is unreachable,
  and the generator prints the diff when the two disagree. Do not invert that
  precedence, and do not "simplify" the endpoint to `/v1/models`: verified
  2026-08-20, v1 returns 102 TTS models and zero Flux ones (all `aura`/`aura-2`)
  while v2 returns 36, all `flux-tts`. Neither version errors on the other's
  request, so the wrong one silently answers zero.
- **`public/clips/` is gitignored.** Generated audio, tens of megabytes. The
  Dockerfile copies it from the build context, so `make clips` before
  `fly deploy`.
- **`DEEPGRAM_API_KEY` is build-time only.** It appears in `scripts/shared.ts`
  and nowhere else. Not in `src/`, not in the server, not in the bundle.

## Removed on purpose

All of this existed briefly and was cut. It is in git history at commit 4a36813.
Do not re-add any of it speculatively.

- The sort modal, the age x gender matrix, and the accent-band layout. Two
  dropdown filters plus a stable A-Z grid do the same job with less UI, so
  `sortVoices(key, direction)` collapsed to `sortByName`.
- The volume slider. System volume is the user's control.
- The live-text panel and its `POST /api/speak` proxy, plus `src/server/wav.ts`
  and `express-rate-limit`. This tool auditions a fixed catalog against a fixed
  script; typing arbitrary text is a different tool. Removing it also took the
  last secret out of the deployed process.
- The handoff rewind, and its words/hold tuning steppers. The run-up existed to
  paper over the old fraction-of-duration mapping: you landed on the wrong word,
  so a few words of context helped you re-find your place. Once handoffs became
  word-exact the rewind was just an audible stutter. If you are tempted to add it
  back, fix the mapping instead.
(The start curtain was removed and then put back. It stays: audio needs a user
gesture and hovering is NOT one -- only pointerdown, keydown and friends count as
user activation -- so without the curtain the first hover is silent with no
explanation. It is keyed off `hasStarted`, never off `playing`, or space-to-pause
would drop a click-blocker back over the grid.)

## Grid columns are named, not computed

`auto-fill` cannot be told to skip a number, and 5 columns must be skipped: 36
voices divide evenly by 6, 4, 3 and 2, so five across leaves a ragged single
tile on the last row. The counts are explicit media queries in `app.css`. The
6-wide band reaches down to 72rem on purpose -- six is the layout this tool is
for, so it holds until tiles would fall under ~176px.

## Editing the audition script

`src/lib/clip-script.ts` is the text every voice reads. Changing it invalidates
every rendered clip. The generator hashes it into `manifest.json` so staleness
is detectable; re-render with `pnpm clips -- --force`.

## The Dockerfile must copy pnpm-workspace.yaml

`allowBuilds` lives there, and it is where esbuild's postinstall is approved.
Copying only `package.json` and the lockfile fails the image build outright with
`ERR_PNPM_IGNORED_BUILDS` -- and it fails ONLY in the build stage, because
esbuild is a devDependency and the `--prod` install never reaches it, so the
error looks like it comes from nowhere.

## Verify

```bash
make check       # prerequisites + the style-pack seal
make install
make typecheck   # client and server
make test
make build
make start       # http://localhost:8080
```

"Runs" means: the grid renders every voice in `manifest.json`, one click starts
the playhead, and sweeping the cursor across the grid swaps voices without the
playhead resetting.
