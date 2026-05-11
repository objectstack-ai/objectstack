# syntax=docker/dockerfile:1.7
#
# ObjectStack Server — production container image
# --------------------------------------------------
# Build with the **repository root** as the build context so the entire pnpm
# workspace (packages, examples, apps/objectos itself) is available to the
# builder stage. Example:
#
#   docker build -f apps/objectos/Dockerfile -t objectstack/objectos:dev .
#   fly deploy --dockerfile apps/objectos/Dockerfile
#
# At runtime the container reads project config from env vars (see
# apps/objectos/README.md for the full list) and optionally mounts a
# persistent volume at /data for the local-SQLite control plane.

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
COPY apps/objectos ./apps/objectos

RUN pnpm install --frozen-lockfile --prod=false

# Build upstream packages that apps/objectos depends on via workspace: protocol.
# `...` expands to "package + all transitive deps in the workspace".
RUN pnpm --filter '@objectstack/objectos...' build


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
    PORT=3000 \
    HOST=0.0.0.0

# Copy the full workspace (with built dist/ directories) and the shared
# node_modules tree. pnpm uses hard-link dedup so the transfer is cheap.
COPY --from=builder /repo /app

EXPOSE 3000
VOLUME ["/data"]

# The container talks to the control plane (local SQLite at /data or remote
# libSQL/Turso) via env. Override in fly.toml / `docker run -e …`.
ENV OS_DATABASE_URL=file:/data/control.db

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1 || exit 1

WORKDIR /app/apps/objectos
CMD ["pnpm", "start"]
