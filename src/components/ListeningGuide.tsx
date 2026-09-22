export function ListeningGuide() {
  return (
    <details className="listening-guide">
      <summary>Listening guide & TTS vocabulary</summary>
      <div className="guide-grid">
        <section>
          <h2>Listen consistently</h2>
          <p><strong>Responsiveness</strong> is time to first audio in a live request. This pre-rendered explorer cannot measure it.</p>
          <p><strong>Intelligibility</strong> asks whether every word is understood. It is the useful listener term, especially for 8 kHz telephony.</p>
          <p><strong>Naturalness</strong> is human plausibility, without robotic cadence or audio artifacts.</p>
          <p><strong>Expressivity & prosody</strong> covers emotional register, rhythm, pitch, pauses, and emphasis.</p>
          <p><strong>Voice fit</strong> covers accent, timbre, age, persona, and use-case match.</p>
        </section>
        <section>
          <h2>Flux controls</h2>
          <p><code>expressivity</code> is a beta −2 to 2 calm-to-animated register offset. Zero is the production-tuned default.</p>
          <p><code>speed</code> changes pace. It is separate from expressivity and is not an emotion control.</p>
          <p><code>sample_rate=8000</code> with μ-law or A-law is the telephony profile. Sample rate is not bitrate.</p>
          <p>Language, accent, gender, age, characteristics, and use case describe a voice; they are selection metadata, not synthesis knobs.</p>
        </section>
      </div>
    </details>
  )
}
