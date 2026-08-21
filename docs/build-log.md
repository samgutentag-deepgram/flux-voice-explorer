# Build log

Reconstructed after the fact, from the pre-rewrite commits (tagged
`pre-rewrite-history`) and the working session. The git history was
subsequently rewritten into build order, so this is the only record of the
route taken rather than the destination.

Kept because the wrong turns are the interesting part. Four of them were
measured, not guessed, and the measurements are the reason the final shape looks
the way it does.

---

## 1. How many voices are there?

Assumed 38 from memory. Wrong twice over.

`GET /v1/models` returns 102 TTS models and **not one of them is Flux** — every
architecture there is `aura` or `aura-2`. `GET /v2/models` returns 36, all
`flux-tts`. Neither endpoint errors on the wrong version, so asking v1 for Flux
voices silently answers zero, which is the worst possible failure mode: a
confident empty list.

The answer is 36, confirmed three ways: the live `/v2/models` response,
Deepgram's public changelog for the 2026-08-12 GA ("36 English voices across
American, British, Irish, Australian, Indian, Singaporean, and Filipino
accents"), and the published voices page, which enumerates exactly those 36.

**Kept as:** the catalog is resolved from the API at generation time, never from
a table. The bundled table is a fallback that prints a diff when the two
disagree.

---

## 2. The clips are not the same length, and that is the whole design

First real surprise. Identical text, 1,365 characters, and:

| | duration |
|---|---|
| Drew (fastest) | 84.2s |
| median | 100.7s |
| Bree (slowest) | 142.2s |

A **69% spread**. Nothing predicts it — Drew and Bree are both American, the
three fastest are adult men, the three slowest are two women and a man. Pace
looks like a per-voice property.

That killed the obvious implementation immediately. A shared playhead in seconds
would put you in a different part of the script depending on which tile you were
hovering.

**Kept as:** the playhead is a position in the *script*, not a timestamp. Also
gave the grid its most interesting sort axis for free: same words, so a shorter
clip is literally a faster talker.

---

## 3. Normalized progress was still wrong, by up to 17 words

The fix for #2 was to make progress a fraction, 0..1, and seek each voice to
`progress * itsDuration`. That silently assumes two voices spend their time
through the script *identically*, only faster or slower.

They do not. Each places its own pauses. Measured on real timings, handing off
from Drew to Bree under that rule:

| Drew is on | you land on | off by |
|---|---|---|
| than | flattered | 8 words |
| voice | flat | 11 words |
| it? | a | 9 words |

Worst case across all 1,260 voice pairs: **17 words**. And the sign flips —
ahead early, behind late — so it is not an offset you can tune out.

**Kept as:** `progress` lives on a canonical timeline (the mean of all 36
measured word timelines) and every element converts through its own word
positions via `fromCanonical` / `toCanonical`. Error is zero by construction.

There is a test that pins the naive version as *wrong*, so it cannot quietly
come back.

---

## 4. A feature that existed only to hide a bug

Before #3 was understood, handoffs landed on the wrong word, which felt
disorienting. The response was a 3-word "rewind" giving the incoming voice a
run-up — with tunable words and a settle window, and a real bug of its own
(sweeping ten tiles cost thirty words and walked the script backwards).

Once the handoff became word-exact, the rewind was just an audible stutter. It
was deleted along with its two UI controls.

**Lesson worth keeping:** a feature that exists to make a bug tolerable is a
signal to go find the bug.

---

## 5. The ticker was 21 words off, and no tuning would fix it

Word-level timings do not come out of batch `/v2/speak` — it returns audio and
nothing else. So the first ticker estimated positions from syllable counts plus
punctuation pauses, and the code claimed accuracy "within about a word."

That claim was never measured. When it was, against STT ground truth:

| real time | word spoken | ticker showed | drift |
|---|---|---|---|
| 20s | pick? | is | 8 words behind |
| 35s | through | question | 11 words behind |
| 80s | sentence | can | 14 words *ahead* |

Worst case **8.9 seconds, 21 words**. The shape is the diagnosis: behind through
the first half, ahead through the second. The model over-weights a section dense
with question marks and under-weights one dense with acronyms and decimals,
because Flux reads those far slower per syllable — and that is not knowable from
the text. No pause constant fixes it.

**Kept as:** `pnpm align` sends each clip back through STT and aligns the
transcript to the script with Needleman-Wunsch. 96-98% of words match outright.
The estimator survives as a labelled fallback with its measured error written
into the comment.

---

## 6. Two clock sources that disagreed for two frames

Reported as "the scrolling text keeps falling behind while I hover different
voices" — with the note that the audio was perfect. That detail is what found it:
audio and ticker read the same playhead, so if only the ticker was wrong, the
playhead itself was being corrupted in a way audio does not notice.

`focus()` seeks the new element, but `play()` returns a promise. For a frame or
two `el.paused` is still true, so the loop fell through to its wall-clock branch
and advanced *past* the seek point. When `play()` resolved, the element became
the source of truth again and the playhead snapped **backward**. Roughly 30ms per
handoff, several handoffs a second while sweeping — accumulating far faster than
the script advances.

**Kept as:** the clock is *held* while a handoff is in flight, and an element is
read only when it is not paused, not seeking, and has metadata. Five regression
tests, one asserting the playhead is monotonic across a hold.

---

## 7. Are these two the same voice?

Asked of Haley and Hannah. They are not: distinct UUIDs, different tag sets, and
identical text renders to 99.0s versus 93.3s.

But the instinct was right. A spectral comparison across all 12 American female
voices — 26 log-spaced bands, loudness-normalized, plus autocorrelation f0 — puts
them **2.5 Hz apart** in median pitch and 3rd closest of 66 pairs, against a
median pair distance roughly 3x larger.

Two pairs are *closer*: Brittany/Kelsey, and Alexis/Haley at an identical
202.5 Hz. So the confusable cluster is not the two H-names; it is a five-voice
pileup of clear-professional-calm American women, and the alliteration is what
made the pair noticeable.

**Practical read:** for two distinguishable American female voices, avoid
{Alexis, Haley, Hannah, Kelsey, Brittany} and reach across the f0 range —
Brooke at 164.9 Hz against Paige at 213.3 Hz is a 48 Hz gap.

---

## 8. Things built and then deleted

Not counting the rewind (#4):

- **A sort modal** with five keys, direction, and three grouping layouts,
  including an age x gender matrix chosen because it was the only facet pairing
  with no empty cells. Cut: two dropdown filters and a stable A-Z grid do the
  same job with less UI.
- **A volume slider.** System volume is the user's control.
- **A live-text panel** with a `POST /api/speak` proxy. Cut as a different tool —
  this one auditions a fixed catalog against a fixed script. Removing it took the
  last secret out of the deployed process, so `fly deploy` needs no
  `fly secrets`.
- **A start curtain**, removed and then restored. It stays: audio needs a user
  gesture and hovering is not one — only pointerdown, keydown and friends count
  as user activation — so without it the first hover is silent with no
  explanation.

---

## 9. Two review passes, and what they caught

A correctness review found twelve issues. Four would have shipped:

- Dragging the ticker to the right edge flipped the display between the last word
  and the first, every frame — `progressAtStripX` returns exactly 1, and the
  end-of-script reset fired against the drag.
- A lost `pointerup` could freeze the app permanently. `releasePointerCapture`
  throws when the pointer is already gone (reachable via `pointercancel`), which
  skipped `onScrubEnd`, left `scrubbing` true, and held the playhead forever with
  no recovery path.
- `pnpm align --force` *discarded* good data: it rebuilt from scratch, so one
  network blip permanently dropped a working alignment.
- The transport scrubber still stuttered — scrub ducking had been added for the
  ticker and never wired to the range input.

A quality review found the two most expensive lines in the app were both
self-inflicted misses on patterns already in the file: the 250-span ticker strip
was reconciled every frame because the *children* were memoized but not the
wrapping element (15,000 fiber clones/sec, the exact cost the file's comment
claimed to avoid), and two facet lists rebuilt 60x/sec for dropdowns that never
change.

It also found the waveform's progress fill drawn in the wrong coordinate space —
canonical `progress` over an axis of clip time — fifteen lines from a click
handler that converted correctly. The cause was structural: the local fraction
was private to the player, so the tile *could not ask* for the number it needed
while the tick loop computed and discarded it every frame.

---

## 10. Made publishable

Before making the repo public, checked whether all 36 voices were shareable. They
are — GA since 2026-08-12, all 36 on the public docs page, diff empty both ways.

One thing did need changing. `/v2/models` returns more character tags than the
docs page prints, and the extras include words the docs deliberately leave off:
it tags Brittany `robotic`, Donovan `angry`, Bree `confused`. Real model
metadata, but not how Deepgram describes its own GA voices, and this is a public
demo.

**Kept as:** displayed characteristics come from the published wording; the full
tag list stays searchable but is never printed.

---

## 11. The pause was on the wrong element

Reported after the deploy: hovering a tile plays it, as designed, but sliding the
mouse *off* a tile leaves the ticker scrolling and the script advancing with no
audio behind it. Hovering the ticker tape did pause, which was the clue.

The auto-pause was a `pointerleave` on `<main class="grid-wrap">`, the container.
Inside that element are the gutters between tiles, the grid's own padding, and
the empty-filter line. None of those are a tile, but all of them are the grid, so
the pointer moving from a tile into a gap fired the tile's own `pointerleave`
(which ducks the voice to silence and deliberately keeps the playhead running)
and nothing else. Reaching the ticker tape finally left the container, which is
why the one place a user would test it worked.

The container was never the right hook. "Something is audible" is a property of a
tile, so the pause belongs on the same event that decides which voice plays.
`VoiceTile` now reports whether a leave came from a mouse, and `handleFocus` in
`App.tsx` pauses on a mouse leaving a tile and resumes on entering the next one.
The grid handler is gone.

Two things that had to survive the move. A deliberate space-bar pause must not be
undone by the next hover, which is what the existing `autoPaused` ref is for.
And on touch, `pointerleave` fires when the finger lifts, so pausing on it would
cut every tap short: only a mouse leave pauses, while a tap still picks up an
auto-pause the mouse left behind.

**Side effect, and an improvement:** crossing a gutter now freezes the playhead
instead of running it forward in silence. Sweeping the grid slowly used to walk
the script on by a gap's worth of median pace per crossing. Now you land on the
word you left.
