# Voice orbs

The 36 official Deepgram Flux voice orbs, one SVG per voice, received
2026-08-22. Nothing at runtime reads these files. They are here so the color
tokens in `src/styles/packs/flux-2026.css` can be re-derived instead of trusted.

## What is in one file

Each orb is a 144x144 circle, clipped by `#cm`, holding:

1. a ground `rect` in `rgb(16,16,20)`, the same in every file
2. two or three stacked shapes in the voice's colors, lowest and widest first
3. a small highlight blurred by `#b8` or `#b4`, in some families
4. an inverse-circle `path` blurred by `#bs`, which reads as a rim light just
   inside the edge rather than as an outer glow, because the clip removes
   everything beyond the circle

The whole stack then goes through `#lb`, a 5px blur. Most families draw the
shapes as ellipses; Maeve and Meena draw wave-shaped paths instead.

## The ten families

There are 36 orbs and **10 color sets**. This is the source data, not a
simplification: five voices are painted the identical orange.

| Family | Voices | Reading |
|---|---|---|
| 1 | Alexis, Marcelo, Sean, Sienna, Tanner | amber over deep orange, white core |
| 2 | Bree, Maeve, Meena | violet into pink, amber underlight |
| 3 | Brittany, Bruce, Priya, Wes | forest into emerald, pale blue core |
| 4 | Brooke | royal into azure |
| 5 | Cliff, Conor, Drew, Marcus | forest and royal under mint |
| 6 | Cole, Kit, Miles, Wade | deep violet into azure |
| 7 | Colin, Elise, Kai, Naveen, Sharon | royal and violet under mint |
| 8 | Donovan, Gemma, Haley, Paige, Rufus | royal into violet into pink |
| 9 | Hannah, Heather, Kelsey, Meghan | deep orange into rose |
| 10 | Jack | two greens under pale blue |

`src/lib/voice-orbs.ts` holds the voice-to-family mapping and a test asserts it
covers the catalog exactly.

## Re-deriving the tokens

Group by the ordered set of non-ground fills plus the `#bs` fill:

```bash
node - <<'JS'
import { readdirSync, readFileSync } from 'node:fs'
const dir = 'assets/voice-orbs'
const fams = new Map()
for (const f of readdirSync(dir).filter((n) => n.endsWith('.svg')).sort()) {
  const layers = (readFileSync(`${dir}/${f}`, 'utf8').match(/<(?:ellipse|path|rect)\b[^>]*>/g) ?? [])
    .map((t) => ({
      rgb: (t.match(/fill="rgb\((\d+,\d+,\d+)\)"/) ?? [])[1],
      filt: (t.match(/filter="url\(#(\w+)\)"/) ?? [])[1] ?? '',
    }))
    .filter((l) => l.rgb && l.rgb !== '16,16,20')
  const glow = layers.filter((l) => l.filt === 'bs').at(-1)?.rgb
  const shapes = [...new Set(layers.filter((l) => l.filt !== 'bs').map((l) => l.rgb))]
  const key = JSON.stringify([shapes, glow])
  fams.set(key, [...(fams.get(key) ?? []), f.replace(/\.svg$/, '')])
}
console.log(fams.size, 'families'); for (const [k, v] of fams) console.log(k, v.join(', '))
JS
```

The `wave` token per family is not produced by that script. It is chosen by
hand against measured contrast, and the rule plus the measurements live in the
`voice orbs` comment block in `src/styles/packs/flux-2026.css`. Do not restate
it here -- it was already wrong in this file once.
