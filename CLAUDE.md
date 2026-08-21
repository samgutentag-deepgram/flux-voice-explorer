See AGENTS.md.

Claude Code specific:

- The clip generator spends real money, one API call per voice. Do not run
  `pnpm clips` speculatively; `pnpm clips -- --list` resolves the catalog and
  renders nothing.
- `make dev` runs two processes under one `trap`. Run it in the background or it
  will hold the shell.
