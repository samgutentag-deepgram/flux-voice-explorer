import { RUBRIC, averageRating, type VoiceEvaluation, type RubricKey } from '../lib/evaluations.ts'
import type { Voice } from '../lib/voices.ts'

type Props = {
  voice: Voice
  evaluation: VoiceEvaluation
  onChange: (patch: Partial<VoiceEvaluation>) => void
  onRating: (key: RubricKey, score: number) => void
  onClose: () => void
}

export function ReviewPanel({ voice, evaluation, onChange, onRating, onClose }: Props) {
  const average = averageRating(evaluation)
  return (
    <aside className="review-panel" data-testid="review-panel" aria-label={`Review ${voice.name}`}>
      <div className="review-head">
        <div>
          <span className="review-kicker">Voice review</span>
          <h2>{voice.name}</h2>
          <p>{[voice.accent, voice.gender, voice.age].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" className="review-close" onClick={onClose} aria-label="Close review">×</button>
      </div>

      <label className="heard-check">
        <input
          type="checkbox"
          checked={evaluation.heard}
          onChange={(event) => onChange({ heard: event.target.checked })}
        />
        I have heard this voice
      </label>

      <div className="rubric-head">
        <h3>Consistent listening rubric</h3>
        <span>{average === null ? 'Not scored' : `${average.toFixed(1)} / 5`}</span>
      </div>
      <p className="review-help">Use the same five dimensions for every voice. 1 is poor, 5 is excellent.</p>
      <div className="rubric-list">
        {RUBRIC.map((item) => (
          <fieldset key={item.key} className="rubric-row">
            <legend title={item.hint}>{item.label}</legend>
            <div className="score-buttons">
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  key={score}
                  type="button"
                  data-selected={evaluation.ratings[item.key] === score || undefined}
                  onClick={() => onRating(item.key, score)}
                  aria-label={`${item.label}: ${score} out of 5`}
                >
                  {score}
                </button>
              ))}
            </div>
            <small>{item.hint}</small>
          </fieldset>
        ))}
      </div>

      <label className="notes-field">
        Notes
        <textarea
          data-testid="voice-notes"
          value={evaluation.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          placeholder="What stood out? Add phrases you want to compare later."
        />
      </label>
      <p className="review-storage">Saved in this browser only.</p>
    </aside>
  )
}
