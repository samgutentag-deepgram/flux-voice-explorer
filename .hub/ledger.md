# Flux Voice Explorer build ledger

Append-only. Newest day at the bottom. This is the raw material for the advocacy cycle, so entries
carry a source and a route, and friction is written symptom-first because the symptom is what
someone searches for.

Tags: `decision` `friction` `deadend` `surprise` `claim` `asset`

---

## Read this before quoting anything below

**The 2026-08-24 entries are backfilled, and they are twice removed from the work.** They were
written on 2026-08-24 from `docs/build-log.md`, which was itself reconstructed after the fact from
the pre-rewrite commits (tagged `pre-rewrite-history`) once the git history had been rewritten into
build order.

So the facts are sourced and checkable, and the *sequence* is a reconstruction. Nothing here is a
record of what it felt like on the day, because nobody was keeping one. Two consequences worth
holding onto:

- Anything below can be quoted if its `Source:` line checks out. The numbers were measured.
- Nothing below should be written up as "and then I noticed", because that is exactly the part that
  was not captured. The build-log post has to be honest that the route was reconstructed.

Entries appended after this day are written live and carry no such caveat.

---

## 2026-08-24 (backfilled from docs/build-log.md)

### [surprise] Identical text runs 84.2s in the fastest voice and 142.2s in the slowest
A 69% spread on 1,365 characters, and nothing in the published voice metadata predicts it. Drew and
Bree are both American. The three fastest are adult men; the three slowest are two women and a man.
Pace is a property of the voice, not of the text. Recomputed from the clip manifest on 2026-08-22
and it holds exactly: Drew 84.16, Bree 142.24, 69.0%.
Source: `docs/build-log.md` section 2 · `public/clips/manifest.json`
Routes to: the personal post's opening number, the social thread's hook

### [deadend] A shared playhead in seconds, killed immediately by the spread
If progress is a timestamp, hovering a different tile puts you in a different part of the script.
Obvious in hindsight, and the 69% spread is what made it obvious.
Source: `docs/build-log.md` section 2
Routes to: build-log post, "the measurement that changed the design" beat

### [friction] Normalized progress was still wrong, by up to 17 words
Symptom first: handing off from one voice to another landed you on the wrong word, and the error
flipped sign - ahead early, behind late - so no constant offset tuned it out. Cause: making progress
a 0..1 fraction and seeking to `progress * itsDuration` assumes two voices spend their time through
the script identically, only faster or slower. They do not; each places its own pauses. Worst case
across all 1,260 voice pairs was 17 words. Fix: `progress` lives on a canonical timeline, the mean of
all 36 measured word timelines, and every element converts through its own word positions via
`fromCanonical` / `toCanonical`. Error is zero by construction, and a test pins the naive version as
wrong so it cannot quietly come back.
Source: `docs/build-log.md` section 3
Routes to: the personal post, and the strongest single technical beat in the set

### [deadend] A three-word rewind that existed only to hide the handoff bug
Built before the 17-word error was understood: an incoming voice got a run-up so the wrong landing
word felt less jarring. It had tunable words, a settle window, and a bug of its own - sweeping ten
tiles cost thirty words and walked the script backwards. Once the handoff became word-exact it was
just an audible stutter, and it went along with its two UI controls.
Source: `docs/build-log.md` section 4
Routes to: "a feature that exists to make a bug tolerable is a signal to go find the bug"

### [claim] The ticker claimed accuracy "within about a word" and was 21 words off
The claim was in a code comment and had never been measured. Measured against speech-recognition
ground truth it was 8 words behind at 20s, 11 behind at 35s, and 14 words *ahead* at 80s. Worst case
8.9 seconds and 21 words. The shape is the diagnosis: the estimator over-weights a section dense with
question marks and under-weights one dense with acronyms and decimals, because Flux reads those far
slower per syllable, and that is not knowable from the text. Superseded by `pnpm align`, which sends
each clip back through speech-to-text and aligns with Needleman-Wunsch.
Source: `docs/build-log.md` section 5 · `scripts/align.ts:6-7`
Routes to: the personal post's second number, and the "measure before you build on it" angle

### [friction] Two clock sources disagreed for two frames and the playhead ran backwards
Symptom first: the scrolling text kept falling behind while hovering different voices, and the audio
was perfect. That detail is what found it - audio and ticker read the same playhead, so if only the
ticker was wrong then the playhead itself was being corrupted in a way audio does not notice. Cause:
`focus()` seeks the new element but `play()` returns a promise, so for a frame or two `el.paused` is
still true and the loop fell through to its wall-clock branch, advancing past the seek point. When
`play()` resolved the element became the source of truth again and the playhead snapped backward.
Roughly 30ms per handoff, several handoffs a second while sweeping. Fix: hold the clock while a
handoff is in flight, and read an element only when it is not paused, not seeking, and has metadata.
Five regression tests, one asserting the playhead is monotonic across a hold.
Source: `docs/build-log.md` section 6
Routes to: build-log post, the "two clocks" beat

### [surprise] The confusable voices are a five-way pileup, not the two H-names
Asked whether Haley and Hannah are the same voice. They are not: distinct UUIDs, different tag sets,
and identical text renders to 99.0s versus 93.3s. But the instinct was right for the wrong reason. A
spectral comparison across all 12 American female voices puts them 2.5 Hz apart in median pitch and
3rd closest of 66 pairs. Two pairs are closer: Brittany/Kelsey, and Alexis/Haley at an identical
202.5 Hz. The real cluster is five clear-professional-calm American women, and the alliteration is
what made one pair noticeable. Practical read: reach across the f0 range instead, Brooke at 164.9 Hz
against Paige at 213.3 Hz is a 48 Hz gap.
Source: `docs/build-log.md` section 7
Routes to: held back from the public set on purpose - see the entry below

### [decision] The similar-voices finding stays internal, and the orb-colour one is optional
Both are measurements of how the catalog is less differentiated than it looks. Either alone is a
useful observation; the two together read as a product critique rather than as two findings, and this
is a public demo of a GA product. The pace spread is the one that ships.
Source: Asana "Small demo push" task 6 · `docs/build-log.md` sections 7 and 10
Routes to: the thread's scope guard

### [decision] Displayed characteristics come from the published wording, not from the API
`/v2/models` returns more character tags than the public docs page prints, and the extras include
words Deepgram deliberately leaves off: Brittany `robotic`, Donovan `angry`, Bree `confused`. Real
model metadata, but not how Deepgram describes its own GA voices. The full tag list stays searchable
and is never printed.
Source: `docs/build-log.md` section 10
Routes to: repo, and a note in the corporate piece if one is ever written

### [friction] The auto-pause was on the grid container, so sliding into a gutter kept the script running
Symptom first: hovering a tile plays it as designed, but sliding the mouse off a tile leaves the
ticker scrolling and the script advancing with no audio behind it. Hovering the ticker tape did
pause, which was the clue. Cause: the auto-pause was a `pointerleave` on `<main class="grid-wrap">`.
The gutters, the grid padding and the empty-filter line are all inside that element, so a pointer
moving from a tile into a gap fired the tile's own leave handler and nothing else. Reaching the
ticker tape finally left the container, which is why the one place a user would test it worked. Fix:
the pause belongs on the same event that decides which voice plays, so `VoiceTile` now reports
whether a leave came from a mouse and `handleFocus` pauses on a mouse leaving a tile. Side effect and
an improvement: crossing a gutter now freezes the playhead instead of running it forward in silence.
Source: `docs/build-log.md` section 11 · commit `e01fd62`
Routes to: the video's slow-sweep shot, which this fix is what makes possible

### [claim] All 36 voices are shareable, checked before the repo went public
GA since 2026-08-12, all 36 on the public docs page, diff empty both ways. Settled generally on
2026-08-21: `flux-marcus-en` and `flux-brittany-en` are cleared for public use in every artifact
type, which reverses the 2026-08-18 forward-only ruling. No capture needs to route around anything.
Source: `docs/build-log.md` section 10 · `~/.claude/CLAUDE.md` settled decisions
Routes to: every drop in the set, and the reason the grid sweep can cross the whole grid

### [asset] The build log itself, 265 lines, reconstructed
Eleven sections, four measured wrong turns, and a list of things built and then deleted. This is the
closest thing to a live record that exists for this project, and it is the reason the personal post
is cheap to write despite nothing having been captured on the day.
Source: `docs/build-log.md`
Routes to: the personal post, the video outline
