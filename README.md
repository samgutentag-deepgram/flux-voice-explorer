# Flux Voice Explorer

Every Deepgram Flux TTS voice reading the same script, on one shared playhead.

**Live: <https://dg-devrel-flux-voice-explorer.fly.dev>**

## Run this yourself

Install three things first: [Node 22 or newer](https://nodejs.org),
[pnpm](https://pnpm.io/installation), and [ffmpeg](https://ffmpeg.org/download.html).
On a Mac, `brew install node pnpm ffmpeg` gets all three at once.

Then run this:

```bash
make init
```

That makes a file called `.env`. Open it and paste your Deepgram API key in after
the `=`, no quotes around it. Get a key at
[console.deepgram.com](https://console.deepgram.com).

Then run these three, in this order:

```bash
make install   # download the code this project depends on
make clips     # make the audio (slow, and it spends money)
make start     # http://localhost:8080
```

`make clips` is the long one. It asks Deepgram which voices exist, has each one
read the script, then sends every finished clip back through speech-to-text to
find out exactly when each word gets spoken. That is two API calls per voice, 72
in total, and a few minutes of waiting. You run it once and never again unless
you change the script.

`make start` prints a URL. Open it, click once anywhere to start the audio, then
sweep your mouse across the grid.

Use `make dev` instead of `make start` if you are editing the code. Same URL,
with hot reload.

## What you are looking at

![The explorer: a six-wide grid of 36 voice tiles, each with a colored orb, under a transport bar and a scrolling ticker of the script. Hannah's tile is focused and her orb is lit](docs/main-ui.png)

Every tile is one voice reading the identical script, so the only variable is the
voice. Hover a tile and you hear that voice at the current position. Move to the
next tile and the voice changes under a playhead that never stopped.

Same words everywhere also makes pace measurable. The seconds figure on each tile
is how long that voice takes to get through the script. Bree needs 142.2s, Drew
needs 84.2s, and the grid sorts by it.

The transport bar across the top marks the five script sections. The ticker below
it scrolls the script with the spoken word lit up. The focused tile is the only
one that draws a waveform, and those bar heights are comparable within a clip but
meaningless between clips (each one is rescaled to its own range). Use the
duration and the pace pip to compare voices.

All 36 voices are the GA catalog, generally available on the hosted API since
2026-08-12 and documented at
[Flux TTS Voices & Languages](https://developers.deepgram.com/docs/flux-tts/voices).

## The orbs

Each tile carries the voice's official Deepgram orb. It sits dim until that voice
is audible, then lights up and moves with the clip's actual amplitude, so a quiet
passage looks quiet. Whichever voice is speaking also colors the transport fill,
the ticker's active word, and that tile's waveform.

Reading the committed orb art gives the one genuinely surprising fact in this
repo: **there are 36 voices and 10 colors.** Alexis, Marcelo, Sean, Sienna and
Tanner are painted the identical orange. Cliff, Conor, Drew and Marcus share a
green and royal blue. That is why the orbs are `aria-hidden` and why color alone
never identifies a voice here. The SVGs are at `assets/voice-orbs/`, and the
README in that folder has the script that re-derives the grouping.

## Keys

| Key | |
|---|---|
| `space` | play / pause |
| `←` `→` | ±5s of the audible voice |
| `shift` `←` `→` | ±30s |
| `/` | focus the filter |

Drag the ticker tape to scrub, or tap a word to jump straight to it. Click the
waveform to jump to that point in the clip.

Hover is the transport once things are playing: moving the mouse off a tile
pauses, moving onto another one resumes where it left off. That is mouse-only on
purpose, because on a touchscreen it would cut every tap short. Hover is not an
accessible path either, so every tile is a real button and tabbing to it plays it
the same way.

## Re-rendering the audio

```bash
pnpm clips                     # render anything missing, then align and analyze
pnpm clips -- --force          # re-render everything
pnpm clips -- --only kit,bree  # substring match on the voice id
pnpm clips -- --list           # print the live catalog, render nothing

pnpm align                     # re-align without re-rendering
pnpm peaks                     # waveform data. Local ffmpeg, no API calls, free
```

`pnpm clips` chains the alignment and the waveforms for you, because rendering
without aligning leaves the ticker highlighting the wrong words.

`--list` is the fastest honest answer to "how many Flux voices are there", since
it asks the API instead of trusting a table.

Editing `src/lib/clip-script.ts` invalidates every clip. The generator hashes the
script text so a stale set is detectable rather than silent. Re-render with
`pnpm clips -- --force`.

## Deploy

```bash
fly apps create dg-devrel-flux-voice-explorer --org <your-org>
make clips     # clips are gitignored, so render before you deploy
make deploy
```

There are no secrets to set. The deployed server holds no API key and talks to
nothing, because every clip is pre-rendered and baked into the image. That is
also why hovering is free: if each hover hit the API, an idle mouse would cost
money.

`public/clips/` is not in git (it is a few tens of megabytes of generated audio)
and the Dockerfile copies it out of the build context, so a fresh clone has to run
`make clips` before it can run or deploy anything.

## Everything else

[`AGENTS.md`](AGENTS.md) has the parts a later edit is most likely to break: why
the playhead is a position in the script rather than a fraction of a clip, why
word timings are measured instead of estimated, the two-resolution waveform data,
the stack versions, and the list of things that were deliberately removed. Start
there before changing anything.
