import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CLIP_WORDS } from '../lib/clip-script.ts'
import { fractionThrough, indexInStarts } from '../lib/word-timeline.ts'

type Props = {
  /** 0..1 through the script. */
  progress: number
  /**
   * Normalized start position per script word for the voice currently speaking.
   * Real STT-aligned timings when available, the syllable estimate otherwise.
   */
  starts: number[]
  /**
   * Orb color family of the voice currently speaking, or undefined when nothing
   * is. Only paints the active word and the playhead marker; see theme.css
   * block 1b for why it rides as a number rather than a color.
   */
  orb: number | undefined
  onSeek: (p: number) => void
  onScrubStart: () => void
  onScrubEnd: () => void
}

/** Pointer travel, in px, past which a tap becomes a drag. */
const DRAG_THRESHOLD = 4

/**
 * Ticker tape of the script, scrolling so the word being spoken sits under the
 * fixed centre marker. Drag it to scrub; tap a word to jump there.
 *
 * Written imperatively on purpose. The strip is 250 spans and the transform
 * changes every animation frame; re-rendering the list at 60fps to move it
 * would reconcile 250 nodes a frame to change one attribute and one transform.
 * So React renders the spans exactly once, and an effect writes
 * `style.transform` plus the active `data-word-active` flag straight to the DOM.
 *
 * Word positions come in as `starts`, which is per voice: the same word sits at
 * a different position in Bree's 142-second reading than in Drew's 84-second
 * one. See word-timeline.ts for where those numbers come from.
 */
export function Ticker({ progress, starts, orb, onSeek, onScrubStart, onScrubEnd }: Props) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([])
  /** Word centre offsets in strip-space, measured after layout. */
  const centres = useRef<number[]>([])
  const activeRef = useRef(-1)

  /** Strip x of a normalized position: the inverse is what dragging needs. */
  const stripXAt = useCallback(
    (p: number): number => {
      const points = centres.current
      if (points.length === 0) return 0
      const i = indexInStarts(starts, p)
      if (i < 0) return 0
      const here = points[i] ?? 0
      const next = points[i + 1] ?? here
      return here + (next - here) * fractionThrough(starts, i, p)
    },
    [starts],
  )

  /**
   * Normalized position of a strip x. The inverse of stripXAt.
   *
   * Uses the same `indexInStarts` / `fractionThrough` pair as everything else:
   * they take a bare number[], so pixel offsets are just another monotonic
   * sequence. Hand-rolling the search here left the two inverses maintained
   * separately, which is where an asymmetry hides.
   */
  const progressAtStripX = useCallback(
    (x: number): number => {
      const points = centres.current
      if (points.length === 0) return 0
      if (x <= (points[0] ?? 0)) return 0
      if (x >= (points.at(-1) ?? 0)) return 1
      const i = indexInStarts(points, x)
      const f = fractionThrough(points, i, x)
      const from = starts[i] ?? 0
      const to = starts[i + 1] ?? 1
      return Math.min(Math.max(from + f * (to - from), 0), 1)
    },
    [starts],
  )

  const measure = useCallback(() => {
    centres.current = spanRefs.current.map((el) => (el ? el.offsetLeft + el.offsetWidth / 2 : 0))
  }, [])

  // Layout effect, not effect: the first paint must already be positioned or
  // the strip flashes at offset zero before jumping to the playhead.
  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    // Observe the RAIL, not the strip. The strip's width changes every time the
    // active word's font-weight does, which fired a 250-span layout read once
    // per word. The rail only changes when the window does, which is the only
    // resize that can move a span.
    const observer = new ResizeObserver(measure)
    if (railRef.current) observer.observe(railRef.current)
    // Web fonts land after first paint and shift every offset, and the rail does
    // not resize when they do.
    void document.fonts?.ready.then(measure)
    return () => observer.disconnect()
  }, [measure])

  useEffect(() => {
    const node = stripRef.current
    if (!node || centres.current.length === 0) return

    const index = indexInStarts(starts, progress)
    if (index < 0) return

    // Inlined rather than calling stripXAt, which would repeat the search above.
    const points = centres.current
    const here = points[index] ?? 0
    const next = points[index + 1] ?? here
    const x = here + (next - here) * fractionThrough(starts, index, progress)
    node.style.transform = `translateX(${-x}px)`

    if (activeRef.current !== index) {
      spanRefs.current[activeRef.current]?.removeAttribute('data-word-active')
      spanRefs.current[index]?.setAttribute('data-word-active', '')
      activeRef.current = index
    }
  }, [progress, starts])

  /**
   * Drag the tape. The grabbed point stays under the pointer, which is why this
   * is anchored to a strip coordinate captured on pointerdown rather than
   * applying a delta to the live progress: applying deltas to a value the drag
   * is itself changing compounds and runs away.
   */
  const drag = useRef<{ id: number; grabbedX: number; startClientX: number; moved: boolean } | null>(
    null,
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore right-click and any secondary button.
      if (e.button !== 0) return
      const rail = railRef.current
      if (!rail) return
      rail.setPointerCapture(e.pointerId)
      const box = rail.getBoundingClientRect()
      drag.current = {
        id: e.pointerId,
        grabbedX: e.clientX - box.left - box.width / 2 + stripXAt(progress),
        startClientX: e.clientX,
        moved: false,
      }
      onScrubStart()
    },
    [progress, stripXAt, onScrubStart],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current
      if (!state || state.id !== e.pointerId) return
      if (!state.moved && Math.abs(e.clientX - state.startClientX) < DRAG_THRESHOLD) return
      state.moved = true
      const rail = railRef.current
      if (!rail) return
      const box = rail.getBoundingClientRect()
      // Keep the grabbed strip point under the pointer.
      const centreOffset = e.clientX - box.left - box.width / 2
      onSeek(progressAtStripX(state.grabbedX - centreOffset))
    },
    [progressAtStripX, onSeek],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current
      if (!state || state.id !== e.pointerId) return
      drag.current = null
      // A tap that never became a drag jumps to the word under the pointer.
      // Handled here rather than with 250 per-word click handlers.
      if (!state.moved) onSeek(progressAtStripX(state.grabbedX))
      // Before the release: releasePointerCapture throws NotFoundError when the
      // pointer is already gone, which pointercancel reaches. Throwing here used
      // to skip onScrubEnd and leave the playhead frozen with no way back.
      onScrubEnd()
      try {
        railRef.current?.releasePointerCapture(e.pointerId)
      } catch {
        // Already released by the browser. Nothing to undo.
      }
    },
    [progressAtStripX, onSeek, onScrubEnd],
  )

  /**
   * The strip ELEMENT, not just its children.
   *
   * Memoizing only the child array still left React reconciling 250 slots and
   * cloning 250 fibers every frame, because the wrapping div was a fresh element
   * each render. Memoizing the div means its fiber sees `oldProps === newProps`
   * and the whole subtree is skipped -- which is what the imperative approach in
   * this file was for in the first place.
   */
  const strip = useMemo(
    () => (
      <div ref={stripRef} className="ticker-strip">
        {CLIP_WORDS.map((word, i) => (
          <span
            key={`${i}-${word}`}
            ref={(el) => {
              spanRefs.current[i] = el
            }}
            className="ticker-word"
          >
            {word}
          </span>
        ))}
      </div>
    ),
    [],
  )

  return (
    <div className="ticker" data-orb={orb}>
      <div
        ref={railRef}
        className="ticker-rail"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        tabIndex={-1}
        aria-label="Position in the script"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        {strip}
      </div>
      <span className="ticker-playhead" />
    </div>
  )
}
