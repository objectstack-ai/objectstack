# syntax=docker/dockerfile:1.7
#
# ObjectStack Cloud — production container image
# --------------------------------------------------
# Cloud-only host: multi-project control plane + Studio template registry.
#
# Build with the **repository root** as the build context so the entire pnpm
# workspace is available to the builder stage. Example:
#
#   docker build -f apps/cloud/Dockerfile -t objectstack/cloud:dev .
#
# Default port is 4000 to mirror `pnpm dev` (apps/cloud sets PORT=4000).
# At runtime the container reads project config from env vars (see
# apps/cloud/README.md for the full list). The control plane DB should be
# pointed at a remote libSQL/Turso instance via OS_DATABASE_URL — the
# container filesystem is ephemeral on most platforms (Cloudflare Containers,
# Fly.io machines without volumes, etc.).

# ──────────────────────────────────────────────────────────────────────────
# Stage 1 — install workspace deps + build required packages
# ──────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

# native bindings for better-sqlite3 and friends
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
RUN corepack enable

# Bring in lockfile + workspace manifest first to maximise layer cache hits
# on subsequent rebuilds where only source code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json tsup.config.ts ./

# Copy every workspace member required at runtime.
# Studio / docs are excluded to keep the image slim (see .dockerignore).
COPY packages ./packages
COPY examples ./examples
COPY apps/cloud ./apps/cloud

RUN pnpm install --frozen-lockfile --prod=false

# Build upstream packages that apps/cloud depends on via workspace: protocol.
# `...` expands to "package + all transitive deps in the workspace".
RUN pnpm --filter '@objectstack/cloud...' build


# ──────────────────────────────────────────────────────────────────────────
# Stage 2 — slim runtime image
# ──────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates wget \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    OS_DISABLE_CONSOLE=1

# Copy the full workspace (with built dist/ directories) and the shared
# node_modules tree. pnpm uses hard-link dedup so the transfer is cheap.
COPY --from=builder /repo /app

EXPOSE 4000
VOLUME ["/data"]

# Default to a local SQLite control DB on the mounted volume. Override
# with a remote libSQL/Turso URL in production (Cloudflare Containers,
# Fly without volumes, etc. have ephemeral filesystems).
ENV OS_DATABASE_URL=file:/data/control.db

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1 || exit 1

WORKDIR /app/apps/cloud
CMD ["pnpm", "start"]
