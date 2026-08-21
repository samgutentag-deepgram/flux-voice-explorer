FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
# pnpm-workspace.yaml holds `allowBuilds`, which is where esbuild's postinstall
# is approved. Without it here, `pnpm install` fails the build outright with
# ERR_PNPM_IGNORED_BUILDS -- and it fails only in this stage, because esbuild is
# a devDependency and the --prod install below never reaches it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# Clips are rendered assets, not build output. They are gitignored, so they
# come in from the build context: run `make clips` before `fly deploy`.
COPY public/clips ./public/clips
CMD ["node", "dist-server/index.js"]
