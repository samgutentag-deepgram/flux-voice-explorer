# One entry point per verb. deepgram.toml calls these, so keep the names.
SHELL := /bin/bash
.DEFAULT_GOAL := help
.PHONY: help init install check start dev clips test typecheck build clean deploy

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | sort | awk 'BEGIN{FS=":.*?## "}{printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2}'

init: ## Create .env from sample.env if it is missing
	@test -f .env || (cp sample.env .env && echo "created .env, paste your key into it")
	@grep -q '^DEEPGRAM_API_KEY=.\+' .env || echo "warning: DEEPGRAM_API_KEY is still empty in .env"

check: ## Prerequisites, plus the style-pack seal
	@command -v node >/dev/null || { echo "node is required (22+)"; exit 1; }
	@command -v pnpm >/dev/null || { echo "pnpm is required: corepack enable"; exit 1; }
	@command -v ffmpeg >/dev/null || { echo "ffmpeg is required to render clips"; exit 1; }
	@node -e 'const [maj]=process.versions.node.split(".").map(Number); if (maj<22) { console.error("node 22+ required, have "+process.versions.node); process.exit(1) }'
	@# The style-pack seal. Literal colors, fonts, and radii live only in
	@# src/styles/packs/. A line that references a token passes.
	@if grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(|font-family:|fontFamily' src \
		--include='*.css' --include='*.ts' --include='*.tsx' --include='*.js' \
		| grep -v 'src/styles/packs/' \
		| grep -v 'var(--'; then \
		echo "LEAK: literal color/font outside src/styles/packs/"; exit 1; \
	else echo "ok   style pack sealed"; fi
	@echo "ok   prerequisites"

install: ## Install dependencies
	pnpm install

clips: ## Render one clip per Flux voice (needs DEEPGRAM_API_KEY)
	pnpm clips

typecheck: ## Type check client and server
	pnpm typecheck
	pnpm exec tsc -p tsconfig.server.json --noEmit

test: ## Run the test suite
	pnpm test

build: ## Build client and server
	pnpm build

start: build ## Build and serve everything on one port
	PORT=8080 pnpm start

dev: ## Vite on 8080, API on 8081
	@trap 'kill 0' EXIT INT TERM; pnpm dev:server & pnpm dev; wait

deploy: ## Deploy to Fly.io (requires rendered clips in the build context)
	@# The Dockerfile COPYs public/clips, and clips are gitignored, so a fresh
	@# clone would fail the build with a confusing docker error. Say it plainly.
	@test -f public/clips/manifest.json || { 		echo "No rendered clips. Run 'make clips' first (needs DEEPGRAM_API_KEY)."; 		exit 1; 	}
	@echo "Deploying $$(ls public/clips/*.mp3 | wc -l | tr -d ' ') clips"
	fly deploy

clean: ## Remove build artifacts (keeps rendered clips)
	rm -rf dist dist-server node_modules/.vite
