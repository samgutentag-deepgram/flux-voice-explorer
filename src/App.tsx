import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SyncPlayer } from './lib/sync-player.ts'
import { loadPeaks, type ClipPeaks } from './lib/peaks.ts'
import {
  ESTIMATED_STARTS,
  loadTimings,
  meanStarts,
  type WordTimings,
} from './lib/word-timeline.ts'
import {
  accentValues,
  loadManifest,
  matchesQuery,
  medianDuration,
  sortByName,
  useCaseValues,
  type LoadedManifest,
  type Voice,
} from './lib/voices.ts'
import { VoiceTile } from './components/VoiceTile.tsx'
import { TransportBar } from './components/TransportBar.tsx'
import { Ticker } from './components/Ticker.tsx'

export function App() {
  const [manifest, setManifest] = useState<LoadedManifest | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [timings, setTimings] = useState<WordTimings | null>(null)
  const [peaks, setPeaks] = useState<ClipPeaks | null>(null)
  /**
   * Matches the 40rem breakpoint in app.css, and exists only to keep the
   * waveform from mounting on phones. The layout itself stays CSS-only.
   */
  const [wideEnoughForWave, setWideEnoughForWave] = useState(
    () => window.matchMedia('(min-width: 40rem)').matches,
  )

  const [query, setQuery] = useState('')
  const [accentFilter, setAccentFilter] = useState('')
  const [useCaseFilter, setUseCaseFilter] = useState('')
  // Shown once, to buy the one user gesture browsers require before audio can
  // start. Not tied to `playing`: space-to-pause must not drop a click-blocker
  // back over the grid.
  const [hasStarted, setHasStarted] = useState(false)

  const [progress, setProgress] = useState(0)
  const [localProgress, setLocalProgress] = useState(0)
  /** Whole seconds: the readout has 1 Hz resolution, so a float churns for free. */
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [failed, setFailed] = useState<string[]>([])

  const searchRef = useRef<HTMLInputElement | null>(null)
  const playerRef = useRef<SyncPlayer | null>(null)

  /**
   * Stable handlers. Inline arrows here were a new identity on every render,
   * i.e. 60 times a second while playing, which defeated VoiceTile's memo (36
   * tiles re-rendering per frame) and Ticker's 250-span useMemo. They go through
   * a ref so they do not depend on the player instance.
   */
  /**
   * True when the pointer leaving the grid paused us, as opposed to the user
   * pausing deliberately. Entering a tile resumes the first kind and must not
   * resume the second, or space-to-pause would be undone by the next hover.
   */
  const autoPaused = useRef(false)
  /** First voice on screen, so pressing play always makes a sound. */
  const firstVisibleId = useRef<string | null>(null)

  const handleFocus = useCallback((id: string | null) => {
    const player = playerRef.current
    if (!player) return
    if (id && autoPaused.current) {
      autoPaused.current = false
      player.play()
    }
    player.focus(id)
  }, [])

  /**
   * Leaving the grid pauses, rather than just ducking to silence.
   *
   * Mouse only. On touch, `pointerleave` fires when the finger lifts, so this
   * would pause on every tap.
   */
  const handleGridLeave = useCallback((e: React.PointerEvent) => {
    const player = playerRef.current
    if (!player || e.pointerType !== 'mouse') return
    if (player.getState().playing) {
      autoPaused.current = true
      player.pause()
    }
  }, [])

  const handleSeek = useCallback((p: number) => playerRef.current?.seek(p), [])
  const handleSeekLocal = useCallback(
    (id: string, fraction: number) => playerRef.current?.seekLocal(id, fraction),
    [],
  )

  /** Play, focusing the first voice on screen if nothing is focused yet. */
  const startPlayback = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    autoPaused.current = false
    if (!player.getState().focusedId && firstVisibleId.current) {
      player.focus(firstVisibleId.current)
    }
    player.play()
  }, [])

  const handleToggle = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    if (player.getState().playing) {
      // A deliberate pause. Not auto: the next hover must not undo it.
      autoPaused.current = false
      player.pause()
    } else {
      startPlayback()
    }
  }, [startPlayback])

  const handleScrubStart = useCallback(() => playerRef.current?.beginScrub(), [])
  const handleScrubEnd = useCallback(() => playerRef.current?.endScrub(), [])

  useEffect(() => {
    loadManifest()
      .then(setManifest)
      .catch((err: Error) => setLoadError(err.message))
    // Real word timings are optional: the grid works without them, the ticker
    // just falls back to the syllable estimate.
    void loadTimings().then(setTimings)
    // Optional too: without it the focused tile just has no waveform.
    void loadPeaks().then(setPeaks)
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(min-width: 40rem)')
    const sync = () => setWideEnoughForWave(query.matches)
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  /** Timeline for when no single voice is speaking. */
  const canonicalStarts = useMemo(() => meanStarts(timings, ESTIMATED_STARTS), [timings])

  const reference = useMemo(() => (manifest ? medianDuration(manifest.voices) : 0), [manifest])

  const player = useMemo(() => {
    if (!manifest) return null
    return new SyncPlayer({
      referenceDuration: reference,
      onUpdate: (state) => {
        setProgress(state.progress)
        setLocalProgress(state.localProgress)
        setElapsed(Math.floor(state.elapsed))
        setPlaying(state.playing)
        setFocusedId(state.focusedId)
        setFailed((prev) =>
          prev.length === state.failed.length && prev.every((id, i) => id === state.failed[i])
            ? prev
            : state.failed,
        )
      },
    })
  }, [manifest, reference])

  useEffect(() => {
    playerRef.current = player
    return () => {
      player?.destroy()
      playerRef.current = null
    }
  }, [player])

  // The canonical timeline is the coordinate system `progress` lives in, so the
  // player needs it before any per-voice conversion can happen.
  useEffect(() => {
    player?.setCanonicalStarts(canonicalStarts)
  }, [player, canonicalStarts])


  // Global keys. Scoped out of text inputs so typing a query does not scrub.
  useEffect(() => {
    if (!player) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      // A range input is not typing. Treating it as such is what stopped the
      // arrow keys working: click the scrubber and it takes focus, our handler
      // bailed out on tagName === 'INPUT', and the range's native stepping took
      // over at one part in a thousand -- about a tenth of a second a press,
      // which reads as "the arrows cannot leave the current word".
      const typing =
        tag === 'TEXTAREA' || (tag === 'INPUT' && (target as HTMLInputElement).type !== 'range')
      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (typing) return
      // preventDefault on all three: otherwise the focused control also acts on
      // the key -- the range steps itself, and space activates a focused button.
      if (e.code === 'Space') {
        e.preventDefault()
        // handleToggle owns the play/pause policy -- clearing the auto-pause
        // flag and picking up the first voice -- so space and the play button
        // cannot disagree. SyncPlayer deliberately has no toggle() of its own.
        handleToggle()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        player!.nudge(e.shiftKey ? -30 : -5)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        player!.nudge(e.shiftKey ? 30 : 5)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player, handleToggle])

  const visible = useMemo(() => {
    if (!manifest) return []
    const filtered = manifest.voices.filter(
      (v) =>
        matchesQuery(v, query) &&
        (!accentFilter || v.accent === accentFilter) &&
        (!useCaseFilter || v.useCases.includes(useCaseFilter)),
    )
    return sortByName(filtered)
  }, [manifest, query, accentFilter, useCaseFilter])

  // Pace rank is computed over the WHOLE catalog, not the filtered view, so the
  // pip means the same thing whatever is on screen.
  const paceRanks = useMemo(() => {
    if (!manifest) return new Map<string, number>()
    const durations = manifest.voices.map((v) => v.duration)
    const min = Math.min(...durations)
    const span = Math.max(...durations) - min || 1
    return new Map(manifest.voices.map((v) => [v.id, (v.duration - min) / span]))
  }, [manifest])

  const byId = useMemo(
    () => new Map((manifest?.voices ?? []).map((v) => [v.id, v])),
    [manifest],
  )
  const focusedVoice = (focusedId && byId.get(focusedId)) || null
  const accents = useMemo(() => accentValues(manifest?.voices ?? []), [manifest])
  const useCases = useMemo(() => useCaseValues(manifest?.voices ?? []), [manifest])
  // Read in startPlayback, which must not depend on render order.
  firstVisibleId.current = visible[0]?.id ?? null
  const failedSet = useMemo(() => new Set(failed), [failed])

  if (loadError) {
    return (
      <main className="empty">
        <h1>No clips yet</h1>
        <p>{loadError}</p>
        <pre>
          cp sample.env .env # then paste your key{'\n'}
          pnpm clips
        </pre>
      </main>
    )
  }

  if (!manifest || !player) {
    return (
      <main className="empty">
        <p>Loading the catalog…</p>
      </main>
    )
  }

  return (
    <div className="app">
      <header className="bar">
        <div className="bar-title">
          <h1>Flux Voice Explorer</h1>
          <p className="bar-sub">
            {manifest.voices.length} voices, same script. Hover a tile to hear it.
            {manifest.catalogSource === 'fallback' && ' Catalog from the bundled table.'}
          </p>
        </div>

        <div className="bar-controls">
          <input
            ref={searchRef}
            className="bar-search"
            type="search"
            placeholder="Filter  /"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <select
            className="bar-select"
            value={accentFilter}
            onChange={(e) => setAccentFilter(e.target.value)}
            aria-label="Filter by accent"
          >
            <option value="">All accents</option>
            {accents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <select
            className="bar-select"
            value={useCaseFilter}
            onChange={(e) => setUseCaseFilter(e.target.value)}
            aria-label="Filter by use case"
          >
            <option value="">All use cases</option>
            {useCases.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>

        </div>
        {manifest.stale && (
          <p className="bar-warning" role="status">
            These clips were rendered from a different script than this build, so the
            ticker may not match the audio. Re-render with{' '}
            <code>pnpm clips -- --force</code>.
          </p>
        )}
      </header>

      <TransportBar
        playing={playing}
        progress={progress}
        referenceDuration={reference}
        elapsed={elapsed}
        starts={canonicalStarts}
        focused={focusedVoice}
        onToggle={handleToggle}
        onSeek={handleSeek}
        onScrubStart={handleScrubStart}
        onScrubEnd={handleScrubEnd}
      />

      {/* Canonical, always: `progress` is already a canonical script position,
          and the player is what converts it into each voice's own timeline. */}
      <Ticker
        progress={progress}
        starts={canonicalStarts}
        onSeek={handleSeek}
        onScrubStart={handleScrubStart}
        onScrubEnd={handleScrubEnd}
      />

      <main
        className="grid-wrap"
        // Leaving the grid pauses. Focus is deliberately NOT cleared, so the
        // transport keeps naming the voice and resuming plays the same one.
        onPointerLeave={handleGridLeave}
      >
        <div className="grid">
          {visible.map((voice: Voice) => (
            <VoiceTile
              key={voice.id}
              voice={voice}
              player={player}
              focused={focusedId === voice.id}
              // Only the focused tile gets a live value. Handing all 36 a new
              // number every frame would defeat VoiceTile's memo and re-render
              // the whole grid at 60fps.
              localProgress={focusedId === voice.id ? localProgress : 0}
              failed={failedSet.has(voice.id)}
              paceRank={paceRanks.get(voice.id) ?? 0}
              // A voice with no alignment gets the canonical timeline, so the
              // conversion is the identity and it behaves as the average voice.
              // There is deliberately no "no timeline" state to special-case.
              starts={timings?.voices[voice.id] ?? canonicalStarts}
              peaks={peaks?.voices[voice.id] ?? null}
              showWave={wideEnoughForWave}
              onFocus={handleFocus}
              onSeekLocal={handleSeekLocal}
            />
          ))}
        </div>
        {visible.length === 0 && <p className="grid-empty">Nothing matches those filters.</p>}
      </main>

      {!hasStarted && (
        <button
          type="button"
          className="curtain"
          onClick={() => {
            setHasStarted(true)
            startPlayback()
          }}
        >
          <span className="curtain-inner">
            <span className="curtain-icon">▶</span>
            <span>Start the playhead, then sweep the grid</span>
            <span className="curtain-keys">space · ← → · shift+← →</span>
          </span>
        </button>
      )}

    </div>
  )
}
