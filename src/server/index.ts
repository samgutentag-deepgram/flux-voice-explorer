/**
 * Thin Express host. Serves the built client and the rendered clips, and nothing
 * else: the browser never talks to Deepgram, so this process holds no secrets
 * and needs none. Deploying it requires no `fly secrets`.
 *
 * In dev, Vite serves the client on 8080 and proxies `/api` here on 8081.
 * In production this process serves everything on one port.
 */

import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Walk up to the directory holding package.json.
 *
 * Not a fixed `../`: built output runs from `dist-server/` (one level down from
 * the root) but `tsx` in dev runs the same file from `src/server/` (two). A
 * hardcoded hop made the dev health check report `clips: false` while Vite was
 * happily serving them, which is a health endpoint that lies.
 */
function findRepoRoot(from: string): string {
  let dir = from
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return from
}

const here = path.dirname(fileURLToPath(import.meta.url))
const root = findRepoRoot(here)
const clientDir = path.join(root, 'dist')
const publicDir = path.join(root, 'public')

const app = express()
app.disable('x-powered-by')

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    clips: existsSync(path.join(publicDir, 'clips', 'manifest.json')),
  })
})

// Clips are large, immutable, and content-addressed by voice id. Cache hard.
app.use(
  '/clips',
  express.static(path.join(publicDir, 'clips'), {
    maxAge: '1y',
    immutable: true,
    setHeaders: (res, filePath) => {
      // The manifest is the one mutable file in there.
      if (filePath.endsWith('manifest.json')) res.setHeader('cache-control', 'no-cache')
    },
  }),
)

app.use(express.static(clientDir))

// The SPA fallback must not swallow these. Without the guard a missing
// manifest.json returns index.html with a 200, and the client reports a JSON
// parse error instead of "run `pnpm clips`".
app.use(['/api', '/clips'], (_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.get('*splat', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'))
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Internal error' })
})

const port = Number(process.env.PORT ?? 8081)
app.listen(port, () => {
  console.log(`flux-voice-explorer listening on http://localhost:${port}`)
})
