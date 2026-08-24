# AGENTS.md

## What this is

A single-page explorer for the Deepgram Flux TTS voice catalog. Every voice is
pre-rendered reading one identical script; the UI puts them on a grid and shares
one normalized playhead across all of them, so hovering a tile plays that voice
at the current position in the script.

Read `README.md` for the user-facing story and how to run it. This file is the
parts that a later edit is most likely to get wrong.

## How the pieces connect

```
scripts/generate-clips.ts     GET /v2/models  -> what voices exist right now
                              POST /v2/speak  -> one clip per voice
                              writes public/clips/*.mp3 + manifest.json

scripts/align-clips.ts        POST /v1/listen -> real word timings per voice
                              writes public/clips/timings.json

scripts/peaks.ts              ffmpeg, no API -> waveform envelopes per voice
                              writes public/clips/peaks.json

src/lib/sync-player.ts        the shared playhead
src/App.tsx                   grid, filters
src/server/index.ts           serves dist/ and public/clips/. No secrets.
```

`public/clips/manifest.json` is the entire contract between the generator and the
UI. There is no build step joining them, so that JSON *is* the API.

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

  Alignment is Needleman-Wunsch against the script, not a straight zip, because
  the token streams do not match: STT spells "429" as "four twenty nine", hears
  "/v2/speak" as loose words, and occasionally drops one. On this script 96-98% of
  words match outright and the rest are interpolated between matched neighbours.
  The mean of the 36 real timelines, used only when nothing is playing, is out by
  at most 3.1s against any single voice.
- **The playhead is normalized (0..1 through the script), not seconds.** The
  clips are different lengths on purpose (same words, different pace), so a
  seconds-based clock would drift against whatever you are hearing. `progress` is
  a position on the canonical timeline, the mean of all 36 measured word
  timelines, and every tile converts it through its own word positions. Hover a
  new tile mid-sentence and you land on the same WORD.

  The cheap version, seeking the new voice to `progress * itsDuration`, is what
  this did first and it is wrong in a way you can hear. It assumes two voices
  spend their time through the script identically, only faster or slower. They do
  not: each places its own pauses. Handing off from Drew (84s) to Bree (142s)
  under the old rule landed 8 to 11 words out, and the worst case across all
  1,260 voice pairs was 17 words. With the per-voice mapping the error is zero by
  construction. See the header comment in `src/lib/sync-player.ts` before touching
  it.

  While a voice is audible it owns the clock, read back through its own timeline,
  so the transport and ticker cannot drift from what you are hearing. The seconds
  readout is the element's own `currentTime`, deliberately not
  `progress * duration`, which is only correct for a voice that paces like the
  average.
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
- **`peaks.json` holds TWO envelopes per clip, at two resolutions, on purpose.**
  `bars` is 72 buckets, range-stretched per clip with a gamma above 1, because
  one bar is over a second of speech and raw RMS draws as a flat block. `levels`
  is 1536 buckets normalized against the clip's peak with a gamma *below* 1,
  because it drives the orb and a quiet passage has to look quiet. Do not
  collapse them into one array: the bars want contrast and the orb wants
  proportion, and either treatment ruins the other consumer. The orb reads its
  amplitude off the playhead POSITION via `levelAt`, not off the audio output,
  which is why it also moves while you scrub and why nothing here touches the
  Web Audio graph. `loadPeaks` rejects any file whose per-voice shape is not
  `{ bars, levels }` rather than half-loading one, and `pnpm peaks` refuses to
  write an empty `voices` map over good data; `pnpm peaks --force` rewrites it
  and costs nothing but ffmpeg time. The same unguarded-write shape still exists
  in `scripts/align-clips.ts`, which has no such refusal.
- **There are 36 voice orbs and 10 colors. That is the source data.** The
  official orb SVGs are committed at `assets/voice-orbs/`, and reading their
  fill stacks out gives ten color sets, not thirty-six: Alexis, Marcelo, Sean,
  Sienna and Tanner are painted the identical orange, Cliff/Conor/Drew/Marcus
  share a green-and-royal, and so on. `src/lib/voice-orbs.ts` is the only place
  that collapse is written down, and `assets/voice-orbs/README.md` has the
  script that re-derives it. Do not "fix" the duplication by inventing 36
  distinct palettes, and do not read a voice's identity off orb color alone --
  the orb is `aria-hidden` for exactly that reason. Colors ride on the tile as
  `data-orb="<n>"`, and `theme.css` maps the number to the semantic
  `--dg-orb-*` slots, so no component ever names a color. `data-orb` sits on
  each tile (its own voice) and on `.transport` and `.ticker` (the voice
  currently speaking). Do not hoist it to a common ancestor to save the two
  props: that was the first version, and it changed five inherited properties
  across the whole tree on every hover, the ticker's 250 word spans included,
  and it forced a family-0 reset so that an unmapped tile would not inherit the
  audible voice's colors.

  The waveform's `--dg-orb-wave` is hand-picked per family, not read off a fixed
  gradient stop: the rule is the most chromatic stop that still clears about 4.5:1
  against the panel, which lands on `mid` six times and `hi` four times. The
  pack comment has the measurements. Do not "regularize" it to one slot --
  the near-white highlights are high-contrast but carry no identity, and the
  deep violets and forest greens are the reverse at 1.6-2.2:1. Families 5 and
  7 share a mint because it is the only stop either one has that clears.
- **Which surfaces follow the voice, and which stay green.** Deliberate, so do
  not "finish" it either way without asking. Following the voice: the orb, the
  focused tile's waveform, the transport fill, the ticker's active word and its
  playhead marker. Staying `--dg-state-live`: the focused tile's border, its 2px
  progress hairline, the pace pip, and the transport's sentence marks. The split
  is that the green things report playback state, which belongs to the
  transport, not to whoever is speaking.
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

## Audio path

The generator asks for raw headerless `linear16` and transcodes to 64 kbit mono
MP3 with ffmpeg. Two reasons, both load-bearing. `container=none` means the
response body IS the PCM buffer, so duration is exact arithmetic on the byte
count instead of a probe, and it sidesteps the batch `container=wav`
placeholder-header bug (a ~2 GB declared data length). MP3 takes a two-minute
clip from ~5.8 MB to ~1 MB, which is what makes a 36-tile page loadable at all.

ffmpeg is a generator prerequisite only. The production image has none.

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
