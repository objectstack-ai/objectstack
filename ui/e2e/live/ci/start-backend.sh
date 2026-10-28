#!/usr/bin/env bash
# Boot a real ObjectStack backend for the live e2e lane — the WORKSPACE
# backend: this tree's own built `@objectstack/cli` serving this tree's
# `examples/app-showcase` (LIVE_BACKEND_APP in backend.env), so the lane runs
# the HEAD console against the HEAD backend (objectstack#27154).
#
# What it does:
#   1. Check the prerequisite: the workspace is installed and the CLI is built.
#      Nothing is built here; the caller builds, as the `Live E2E UI` job does:
#        pnpm exec turbo run build --filter=@objectstack/cli... \
#          --filter=@objectstack/example-showcase...
#      A missing build refuses by name instead of booting into a stack trace.
#   2. `objectstack dev --seed-admin --fresh` from the checked-out app on
#      $LIVE_BACKEND_PORT with a throwaway sqlite db, then poll the seeded
#      sign-in until it answers.
#
# Until #27154 this script booted PUBLISHED packages: it resolved the
# `@objectstack/cli@$OBJECTSTACK_VERSION` release tag, sparse-checked-out the
# showcase at it and `npm install`ed the release on top. backend.env says why
# that pin retired; the tag resolve, the install and its vitest override went
# with it.
#
# Env overrides:
#   LIVE_BACKEND_DIR   scratch dir for the pid file and the log
#                      (default: $TMPDIR/objectui-live-backend)
#   LIVE_BACKEND_PORT  backend port (default: 4010)
#
# Companion: stop-backend.sh (kills only the PID this script recorded).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=backend.env
source "$SCRIPT_DIR/backend.env"

# ui/e2e/live/ci -> the repository root, four levels up.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BACKEND_DIR="${LIVE_BACKEND_DIR:-${TMPDIR:-/tmp}/objectui-live-backend}"
PORT="${LIVE_BACKEND_PORT:-4010}"
APP_DIR="$REPO_ROOT/$LIVE_BACKEND_APP"
CLI_BIN="$APP_DIR/node_modules/.bin/objectstack"

mkdir -p "$BACKEND_DIR"

prepare() {
  local missing=0
  if [ ! -f "$APP_DIR/objectstack.config.ts" ]; then
    echo "[live-backend] missing: $LIVE_BACKEND_APP/objectstack.config.ts (LIVE_BACKEND_APP in backend.env)" >&2
    missing=1
  fi
  if [ ! -x "$CLI_BIN" ]; then
    echo "[live-backend] missing: $LIVE_BACKEND_APP/node_modules/.bin/objectstack (the workspace is not installed)" >&2
    missing=1
  fi
  if [ ! -f "$REPO_ROOT/packages/cli/dist/index.js" ]; then
    echo "[live-backend] missing: packages/cli/dist/index.js (the CLI is not built)" >&2
    missing=1
  fi
  if [ "$missing" -ne 0 ]; then
    echo "[live-backend] the workspace backend is not ready. From $REPO_ROOT:" >&2
    echo "[live-backend]   pnpm install --frozen-lockfile" >&2
    echo "[live-backend]   pnpm exec turbo run build --filter=@objectstack/cli... --filter=@objectstack/example-showcase..." >&2
    exit 1
  fi
  echo "[live-backend] prepare: workspace @objectstack/cli $(node -p 'require(process.argv[1]).version' "$REPO_ROOT/packages/cli/package.json") on $LIVE_BACKEND_APP at $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'an unknown commit')"
}

start() {
  # Trust a recorded pid only if it is alive AND is actually an objectstack
  # process — a stale pid file's raw number may by now name an unrelated
  # process.
  if [ -f "$BACKEND_DIR/backend.pid" ]; then
    local old_pid
    old_pid="$(cat "$BACKEND_DIR/backend.pid")"
    if kill -0 "$old_pid" 2>/dev/null && grep -qa objectstack "/proc/$old_pid/cmdline" 2>/dev/null; then
      echo "[live-backend] already running (pid $old_pid)"
      return
    fi
    rm -f "$BACKEND_DIR/backend.pid"
  fi
  echo "[live-backend] starting objectstack dev on :$PORT (log: $BACKEND_DIR/backend.log)"
  # --fresh: throwaway sqlite db, auto-removed on SIGTERM. OS_CLOUD_URL=off:
  # no marketplace/cloud calls — the lane must be hermetic.
  # The `cd` runs first and only the `nohup …` command goes to the background,
  # so `$!` is the `objectstack dev` process itself (nohup and pnpm's bin shim,
  # which ends in `exec node …/packages/cli/bin/run.js`, both exec in place);
  # its SIGTERM takes down the `serve` child that holds the port. Backgrounding
  # `cd … && nohup …` as one list forks a subshell and records ITS pid instead:
  # stop-backend.sh then kills that subshell and the server keeps the port, and
  # the `already running` check above never matches, because the subshell's
  # cmdline is this script's (objectui#12676).
  (cd "$APP_DIR"
    OS_CLOUD_URL=off nohup "$CLI_BIN" dev \
      --seed-admin --fresh -p "$PORT" > "$BACKEND_DIR/backend.log" 2>&1 &
    echo $! > "$BACKEND_DIR/backend.pid")

  # Ready = the seeded admin can actually sign in (same call the e2e
  # global-setup makes). Seeding runs at boot, so plain TCP is not enough.
  local deadline=$((SECONDS + 300))
  until curl -sf -o /dev/null -X POST "http://localhost:$PORT/api/v1/auth/sign-in/email" \
      -H 'Content-Type: application/json' \
      -d '{"email":"admin@objectos.ai","password":"admin123"}'; do
    if ! kill -0 "$(cat "$BACKEND_DIR/backend.pid")" 2>/dev/null; then
      echo "[live-backend] backend process died — last 100 log lines:" >&2
      tail -100 "$BACKEND_DIR/backend.log" >&2
      exit 1
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "[live-backend] not ready after 300s — last 100 log lines:" >&2
      tail -100 "$BACKEND_DIR/backend.log" >&2
      exit 1
    fi
    sleep 2
  done
  echo "[live-backend] ready: seeded sign-in answered on :$PORT (pid $(cat "$BACKEND_DIR/backend.pid"))"
}

prepare
start
