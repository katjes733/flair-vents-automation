# syntax=docker/dockerfile:1

# ---- Stage 1: Build Vite frontend ----
FROM oven/bun:1.3.14 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Build React frontend → outputs to public/ (via vite.config.ts build.outDir)
RUN bun run build-client

# ---- Stage 2: Production runtime ----
FROM oven/bun:1.3.14 AS production
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# bunfig.toml preloads src/server/bootstrap/logger-global.ts — required for the
# global `logger` to exist before main.ts executes.
# tsconfig.json is required for Bun to resolve the ~/ path alias.
COPY bunfig.toml tsconfig.json ./

# Server source (Bun runs TypeScript natively — no compile step needed)
COPY src/server ./src/server
COPY src/shared ./src/shared

# Built React frontend static files
COPY --from=builder /app/public ./public

# SSL certs (app HTTPS) and the Postgres CA are injected at runtime via bind mounts:
#   -v /share/Container/container-data/flair-vents-automation/certs:/app/ssl:ro
#   -v /share/Container/container-data/postgres-certs:/app/db-certs:ro

USER bun
EXPOSE 3001
ENV NODE_ENV=production

CMD ["bun", "src/server/main.ts"]
