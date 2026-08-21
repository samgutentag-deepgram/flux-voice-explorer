import { memo, useEffect, useMemo, useRef } from 'react'
import { peaksPath } from '../lib/peaks.ts'
import type { Voice } from '../lib/voices.ts'
import type { SyncPlayer } from '../lib/sync-player.ts'

type Props = {
  voice: Voice
  player: SyncPlayer
  focused: boolean
  /**
   * 0..1 through the AUDIBLE CLIP, not through the script. Both things this tile
   * draws -- the fill hairline and the waveform's played region -- sit on an x
   * axis of uniform slices of this clip's duration, so the script position would
   * be several words off. The click handler converts the other way, via
   * `seekLocal`.
   */
  localProgress: number
  failed: boolean
  /** Fastest..slowest position of this voice, 0..1. Drives the pace pip. */
  paceRank: number
  /**
   * This voice's measured word positions. The player needs them to convert the
   * shared script playhead into this clip's own timeline.
   */
  starts: number[]
  /**
   * RMS envelope for this clip, or null if peaks.json is missing or stale. Only
   * drawn while this tile is the audible one.
   */
  peaks: number[] | null
  /**
   * False on phones, where the row layout has no empty middle to fill. A real
   * prop rather than `display: none`: hidden-but-mounted still wrote a clipPath
   * attribute every animation frame on a node nobody could see.
   */
  showWave: boolean
  /**
   * `mayPause` says the pointer leaving may stop the playhead, not just duck
   * this voice. True for a mouse and for keyboard blur; false for touch, where
   * `pointerleave` fires on finger-lift and would cut every tap short.
   */
  onFocus: (id: string | null, mayPause?: boolean) => void
  /** Seek to a fraction of THIS clip. The player converts it to script position. */
  onSeekLocal: (id: string, fraction: number) => void
}

/**
 * One voice. The <audio> element lives here and is handed to the player on
 * mount, which is why this is memoized: a re-render that swapped the element
 * would drop the buffered audio mid-hover.
 *
 * Focus is driven by pointer AND keyboard. Hover is the fun path but it is not
 * an accessible one on its own, so the tile is a real button and focusing it
 * with the keyboard plays it exactly the same way.
 */
export const VoiceTile = memo(function VoiceTile({
  voice,
  player,
  focused,
  localProgress,
  failed,
  paceRank,
  starts,
  peaks,
  showWave,
  onFocus,
  onSeekLocal,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // The focused tile re-renders every animation frame, and the bar path is 72
  // segments of string building. It depends only on the clip.
  const wavePath = useMemo(() => (peaks?.length ? peaksPath(peaks) : ''), [peaks])

  // Constant per voice, and the focused tile re-renders every animation frame.
  const text = useMemo(
    () => ({
      meta: [voice.accent, voice.gender, voice.age].filter(Boolean).join(' · '),
      chars: voice.characteristics.slice(0, 3).join(', '),
      duration: `${voice.duration.toFixed(1)}s`,
      clipId: `played-${voice.id}`,
    }),
    [voice],
  )

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    player.register(voice.id, el, voice.duration, starts)
    return () => player.unregister(voice.id)
    // `starts` is deliberately NOT a dep. It changes once, when timings.json
    // lands, and re-running this would pause and re-bind the element -- audibly,
    // if it happens mid-hover. The effect below updates it in place instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, voice.id, voice.duration])

  useEffect(() => {
    player.setTrackStarts(voice.id, starts)
  }, [player, voice.id, starts])

  return (
    <button
      type="button"
      className="tile"
      data-focused={focused || undefined}
      data-failed={failed || undefined}
      onPointerEnter={() => onFocus(voice.id)}
      onPointerLeave={(e) => onFocus(null, e.pointerType === 'mouse')}
      onFocus={() => onFocus(voice.id)}
      onBlur={() => onFocus(null, true)}
      aria-label={`${voice.name}, ${voice.accent} ${voice.age}. Hover or focus to hear.`}
    >
      <span
        className="tile-fill"
        style={{ transform: `scaleX(${focused ? localProgress : 0})` }}
      />

      {/* Name, accent line, and description are the only parts that survive to
          phone width. The pace pip and the footer are hidden there by CSS, so
          the markup is the same at every size -- see the MOBILE block in
          app.css. The accent line sits inside .tile-head so that on a phone it
          can share the first row with the name. */}
      <span className="tile-head">
        <span className="tile-name">{voice.name}</span>
        <span className="tile-meta">{text.meta}</span>
        <span className="tile-pace" title={`${text.duration} for the same script`}>
          <span className="tile-pace-pip" style={{ left: `${paceRank * 100}%` }} />
        </span>
      </span>

      <span className="tile-chars">{text.chars}</span>

      {/* Only the audible tile draws its waveform. Thirty-six of these at once
          would be noise, and the empty middle of an unfocused tile is what makes
          the focused one obvious. */}
      {focused && showWave && wavePath && (
        <svg
          className="tile-wave"
          viewBox={`0 0 ${peaks!.length} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
          onClick={(e) => {
            // The tile is a button; do not let this also count as a tile press.
            e.stopPropagation()
            const box = e.currentTarget.getBoundingClientRect()
            if (box.width > 0) onSeekLocal(voice.id, (e.clientX - box.left) / box.width)
          }}
        >
          <defs>
            <clipPath id={text.clipId}>
              {/* One attribute per frame. The paths themselves never change. */}
              {/* Rounded: the raw product stringifies to 17-digit floats like
                  43.199999999999996 into the DOM every frame. */}
              <rect
                x="0"
                y="0"
                height="100"
                width={Math.round(peaks!.length * localProgress * 100) / 100}
              />
            </clipPath>
          </defs>
          <path className="tile-wave-base" d={wavePath} />
          <path className="tile-wave-played" d={wavePath} clipPath={`url(#${text.clipId})`} />
        </svg>
      )}

      <span className="tile-foot">
        <code className="tile-id">{voice.id}</code>
        <span className="tile-dur">{text.duration}</span>
      </span>

      {failed && <span className="tile-error">clip failed to load</span>}

      <audio ref={audioRef} src={voice.clip} preload="metadata" />
    </button>
  )
})
