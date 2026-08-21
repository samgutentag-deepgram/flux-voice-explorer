import { memo, useMemo } from 'react'
import { SECTION_STARTS } from '../lib/clip-script.ts'
import type { Voice } from '../lib/voices.ts'

type Props = {
  playing: boolean
  /** 0..1 through the script. */
  progress: number
  /** Median clip length. What the readout falls back to with nothing playing. */
  referenceDuration: number
  /** Seconds into the audible clip. Comes from the element, not from progress. */
  elapsed: number
  /** Canonical word positions, for placing the section markers. */
  starts: number[]
  focused: Voice | null
  onToggle: () => void
  onSeek: (p: number) => void
  onScrubStart: () => void
  onScrubEnd: () => void
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The playhead is a canonical script position, not seconds, because the clips
 * are different lengths and pace the script differently. The seconds readout is
 * therefore the audible element's OWN elapsed time, denominated in the focused
 * voice's own duration: "1:04 of 1:52 of Bree" is true, "1:04 of the script" is
 * not a thing anyone can picture. It is deliberately not `progress * duration`,
 * which is only correct for a voice that paces like the average.
 *
 * Section markers are placed on the canonical timeline via the word index each
 * section starts at, so a marker sits exactly where that section begins and
 * clicking it lands on the first word. They used to be positioned by character
 * count, which was a different coordinate space from the fill bar drawn beside
 * them -- fine when nothing knew the real word timings, wrong now that
 * `canonicalStarts` does.
 */
export function TransportBar({
  playing,
  progress,
  referenceDuration,
  elapsed,
  starts,
  focused,
  onToggle,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: Props) {
  const total = focused?.duration ?? referenceDuration

  const markers = useMemo(
    () => SECTION_STARTS.map((s) => ({ ...s, at: starts[s.word] ?? 0 })),
    [starts],
  )

  // Descending scan rather than [...markers].reverse().find(), which copied the
  // array on every render just to search it backwards.
  let activeSection = markers[0]
  for (let i = markers.length - 1; i >= 0; i -= 1) {
    if (progress >= markers[i]!.at) {
      activeSection = markers[i]
      break
    }
  }

  return (
    <div className="transport">
      <button
        type="button"
        className="transport-play"
        onClick={onToggle}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '⏸' : '▶'}
      </button>

      <div className="transport-track">
        <input
          type="range"
          className="transport-range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={(e) => onSeek(Number(e.target.value) / 1000)}
          // Same reason the ticker ducks: a drag fires an input event per pixel,
          // and re-seeking a playing element that often is a stutter.
          onPointerDown={onScrubStart}
          onPointerUp={onScrubEnd}
          onPointerCancel={onScrubEnd}
          onBlur={onScrubEnd}
          aria-label="Position in the script"
        />
        <span className="transport-fill" style={{ transform: `scaleX(${progress})` }} />
        <SectionMarks
          markers={markers}
          activeId={activeSection?.id}
          onSeek={onSeek}
        />
      </div>

      <div className="transport-readout">
        <span className="transport-time">
          {clock(elapsed)} / {clock(total)}
        </span>
        <span className="transport-who">{focused ? focused.name : 'median pace'}</span>
      </div>
    </div>
  )
}


/**
 * Memoized because it renders every animation frame otherwise, and the only
 * thing that ever changes is which mark is active -- a few times a minute.
 */
const SectionMarks = memo(function SectionMarks({
  markers,
  activeId,
  onSeek,
}: {
  markers: { id: string; label: string; at: number }[]
  activeId: string | undefined
  onSeek: (p: number) => void
}) {
  return (
    <div className="transport-marks">
      {markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className="transport-mark"
          data-active={m.id === activeId || undefined}
          style={{ left: `${m.at * 100}%` }}
          onClick={() => onSeek(m.at)}
          title={`Jump to: ${m.label}`}
        >
          <span className="transport-mark-label">{m.label}</span>
        </button>
      ))}
    </div>
  )
})
