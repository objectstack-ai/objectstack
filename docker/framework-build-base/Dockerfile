# syntax=docker/dockerfile:1
#
# ObjectStack framework BUILD BASE image
#   ghcr.io/objectstack-ai/framework-build-base:<full framework commit sha>
#
# Built and pushed by .github/workflows/framework-build-base.yml, on demand,
# for one framework commit on `main`. NOT the runtime image: that one is
# ghcr.io/objectstack-ai/objectstack (docker/Dockerfile), a global npm install
# of a RELEASED @objectstack/cli. This one is a builder stage frozen at a
# commit: the framework source tree at /repo/objectstack with its workspace
# dependencies installed (dev dependencies included), every package built, and
# the Console built into packages/console/dist.
#
# Who it is for: a downstream image that consumes the framework as a pnpm
# workspace by `link:` path (`link:../../../objectstack/packages/*`) and pins it
# by commit rather than by release. It starts `FROM` this image and adds its own
# tree beside /repo/objectstack, instead of installing and building the whole
# framework (and the Console) itself on every cold cache or pin move.
#
# Build invocation (what the workflow runs; the context is a checkout of the
# commit being packaged, this file can come from another checkout):
#   docker build -f <builder>/docker/framework-build-base/Dockerfile \
#     --build-arg FRAMEWORK_SHA=<40-hex sha of the checkout> <checkout>
#
# Every build step below is the framework stage downstream images run today,
# with the same arguments: `pnpm install --frozen-lockfile --prod=false`, the
# typeless build of every package except docs and `ui/`, then the typed Console
# build. Keep them in step: an image built here with different arguments is not
# a drop-in for that stage.
#
# Only this repository's own tree goes in (Apache-2.0 outside `ui/`, MIT inside
# it, LICENSING.md). The image is public, so: no `.git` (it carries the
# checkout's credentials header; Dockerfile.dockerignore excludes it and the
# workflow checks out with persist-credentials: false), no build secret, no
# token in any layer.

FROM node:22-slim

# python3/make/g++ for native modules (the install compiles some from source),
# git for the build scripts that shell out to it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

ENV CI=true

# Skip .d.ts generation, as downstream image builds do: the runtime never loads
# a declaration, and the dts pass is the largest single build cost. It stays SET
# in the finished image on purpose, because the downstream stage that starts
# FROM here builds its own packages with it too. The one exception is the
# Console's build closure, which is rebuilt typed below (the Console compiles
# against those packages' dist/*.d.ts). turbo hashes OS_SKIP_DTS (turbo.json
# globalEnv), so the two passes never replay each other's outputs.
ENV OS_SKIP_DTS=1

# The version `packageManager` in package.json names; corepack refuses any other.
ARG PNPM_VERSION=10.31.0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# The store lives in a cache mount during the build, so it never lands in a
# layer. A downstream install that mounts the same path finds the setting.
RUN pnpm config set store-dir /pnpm/store

COPY . /repo/objectstack/

# The authorable-surface deletion check in @objectstack/spec's build fails
# closed without a baseline. With no `.git` in this stage it anchors on the
# committed packages/spec/authorable-surface.base.json; assert the file arrived,
# so a context that dropped it fails here, in one second, with the reason.
RUN set -eu; \
    base=/repo/objectstack/packages/spec/authorable-surface.base.json; \
    if [ ! -f "$base" ]; then \
      echo "✗ $base is missing: the authorable-surface deletion check has no baseline" >&2; \
      echo "  to anchor on in a build stage with no .git, and fails closed. Either this" >&2; \
      echo "  commit predates the committed baseline, or the context excluded packages/spec." >&2; \
      exit 1; \
    fi; \
    echo "→ authorable-surface deletion-check anchor: in-tree baseline $(node -p "require('$base').baseRev")"

WORKDIR /repo/objectstack

# Install with the framework's own lockfile, then build every package except
# the docs site and the `ui/` workspace (the next RUN builds the part of `ui/`
# the Console needs, typed). The 12 GB heap: @objectstack/spec's gen:schema
# loads the whole schema set in one tsx worker thread, which outgrew 8 GB
# (ERR_WORKER_OUT_OF_MEMORY is a per-worker V8 limit, not an OS kill), and
# --concurrency=1 keeps that one heavy worker alone on a 16 GB runner.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=fw-turbo,target=/repo/objectstack/.turbo,sharing=locked \
    --mount=type=cache,id=fw-node-cache,target=/repo/objectstack/node_modules/.cache,sharing=locked \
    npm_config_registry=https://registry.npmjs.org \
    NODE_OPTIONS=--max-old-space-size=12288 \
    pnpm install --frozen-lockfile --prefer-offline --prod=false \
 && NODE_OPTIONS=--max-old-space-size=12288 pnpm exec turbo run build --filter='!@objectstack/docs' --filter='!./ui/**' --concurrency=1

# The Console, built from this tree's ui/apps/console into
# packages/console/dist (the directory the CLI serves) by the root
# `console:build` pipeline, typed (`env -u OS_SKIP_DTS`). ORDER IS
# LOAD-BEARING: it runs after the typeless build above, so the typed rebuild of
# the Console's closure is the one left on disk.
#
# Its build identity: the help menu names the commit the Console was built
# from, through VITE_APP_VERSION (the first 8 hex of FRAMEWORK_SHA). No `.git`
# reaches this stage, so Vite's git fallback has nothing to read; the value must
# be passed. turbo infers VITE_* for a Vite package, so it reaches Vite and
# moves the Console task's hash.
#
# The three VITE_SENTRY_* assignments are the levers the self-managed image
# built with, so one Console here serves every downstream image: an empty DSN,
# the kill switch off, the PII default off. On this tree's Console they are no
# longer read (client error reporting is configured at runtime), so they cost
# nothing; they stay so that a build-time DSN that ever comes back cannot ship
# silently in a customer artefact. They sit on the turbo command through `env`,
# never on a command chained after it.
#
# ui/ is removed at the end: the runtime serves packages/console/dist, and no
# package outside ui/ depends on an @object-ui/* one.
ARG FRAMEWORK_SHA
RUN --mount=type=cache,id=fw-turbo,target=/repo/objectstack/.turbo,sharing=locked \
    --mount=type=cache,id=fw-node-cache,target=/repo/objectstack/node_modules/.cache,sharing=locked \
    set -eu; \
    if ! printf '%s' "${FRAMEWORK_SHA:-}" | grep -Eq '^[0-9a-f]{40}$'; then \
      echo "✗ FRAMEWORK_SHA must be the full 40-hex commit of the build context, got '${FRAMEWORK_SHA:-}'" >&2; \
      exit 1; \
    fi; \
    env -u OS_SKIP_DTS \
      VITE_SENTRY_DSN= \
      VITE_SENTRY_ENABLED=false \
      VITE_SENTRY_SEND_DEFAULT_PII=false \
      VITE_APP_VERSION="$(printf '%.8s' "$FRAMEWORK_SHA")" \
      NODE_OPTIONS=--max-old-space-size=12288 \
      pnpm exec turbo run build:dist --filter=@objectstack/console --concurrency=1 \
 && test -f /repo/objectstack/packages/console/dist/index.html \
 && rm -rf /repo/objectstack/ui

WORKDIR /repo

LABEL org.opencontainers.image.source="https://github.com/objectstack-ai/objectstack" \
      org.opencontainers.image.title="ObjectStack framework build base" \
      org.opencontainers.image.description="Framework source at one commit, dependencies installed, every package and the Console built: a builder stage for images that link the framework by path" \
      org.opencontainers.image.licenses="Apache-2.0 AND MIT" \
      org.opencontainers.image.revision="${FRAMEWORK_SHA}"
