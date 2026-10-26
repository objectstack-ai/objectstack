#!/usr/bin/env bash
# Boot a real ObjectStack backend for the live e2e lane — from PUBLISHED
# @objectstack/* packages, serving the showcase app the live specs target.
#
# What it does (idempotent; a stamp file skips prepare when pins are unchanged):
#   1. Resolve the `@objectstack/cli@$OBJECTSTACK_VERSION` release tag to a
#      commit, and sparse-checkout `examples/app-showcase` from
#      objectstack-ai/objectstack at it. The commit is DERIVED, never pinned:
#      see the note above OBJECTSTACK_VERSION in backend.env (objectui#7964).
#   2. Rewrite its package.json: every `@objectstack/*` workspace dep -> the
#      pinned published OBJECTSTACK_VERSION; dev-only tooling dropped.
#   3. `npm install` (published tarballs only — nothing is built from source,
#      so the lane tests the console against the released artifacts). The
#      published manifests decide what installs, which is the pair this lane
#      exists to test, with ONE exception: the root `overrides.vitest` that
#      npm 10 needs to install the published graph at all (see VITEST_OVERRIDE
#      below for why, and for when it goes).
#   4. `objectstack dev --seed-admin --fresh` on $LIVE_BACKEND_PORT with a
#      throwaway sqlite db, then poll the seeded sign-in until it answers.
#
# Env overrides:
#   LIVE_BACKEND_DIR   scratch dir (default: $TMPDIR/objectui-live-backend)
#   LIVE_BACKEND_PORT  backend port (default: 4010)
#   OBJECTSTACK_REPO_URL  metadata source repo (default: GitHub)
#
# Companion: stop-backend.sh (kills only the PID this script recorded).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=backend.env
source "$SCRIPT_DIR/backend.env"

BACKEND_DIR="${LIVE_BACKEND_DIR:-${TMPDIR:-/tmp}/objectui-live-backend}"
PORT="${LIVE_BACKEND_PORT:-4010}"
REPO_URL="${OBJECTSTACK_REPO_URL:-https://github.com/objectstack-ai/objectstack.git}"
APP_DIR="$BACKEND_DIR/app"
STAMP="$BACKEND_DIR/.prepared"

# The one transitive override the install writes, as a root `overrides` entry in
# the rewritten manifest (objectui#12649). Without it, npm 10 (the npm Node 22
# ships, and so the npm this lane's runner installs with) cannot install the
# published @objectstack/cli graph: it dies building the ideal tree with
# `Cannot read properties of null (reading 'edgesOut')`. The graph reaches
# `vitest` only as an OPTIONAL peer (at 18.0.0-next.2: `better-auth`'s, under
# plugin-auth, and `@objectstack/metadata-core`'s). The newest vitest 4 peers
# `@vitest/browser-webdriverio ^4.1.11`, whose only 4.x match peers back on an
# older vitest exactly, and npm 10's peer-set walk crashes on that set instead
# of resolving it. Holding vitest at 4.0.x gives it a coherent set to resolve.
# Nothing installs vitest, so the override steers the resolver and changes no
# package the backend runs: measured once, at 18.0.0-next.2, the tree npm 10
# installs with it was the tree npm 11 installs without it, path for path and
# version for version — a one-off reading that nothing here re-derives.
# It is the remedy objectstack documents for this crash (its troubleshooting
# entry "Cannot read properties of null (reading 'edgesOut') from npm install").
# The value is part of the stamp below, so a fixture prepared under another
# recipe — the Actions cache restores one without asking — is rebuilt, never
# reused: the cold install cannot hide behind a cache hit.
# ⛔ Remove it (this line, the `overrides` line in prepare(), and the stamp's
# third component) once the published `@objectstack/cli` at OBJECTSTACK_VERSION
# installs on npm 10 with no override. Re-measure on every pin bump: drop the
# `overrides` line, run this script under npm 10 with a FRESH LIVE_BACKEND_DIR
# and a fresh npm cache, and read the install's exit. A re-run in a prepared dir
# proves nothing, because an install from its package-lock.json never crashes.
VITEST_OVERRIDE='~4.0.0'

# The showcase-app commit is DERIVED here, and is declared nowhere: it is
# whatever the `@objectstack/cli@$OBJECTSTACK_VERSION` release tag points at, so
# the metadata checked out below and the published packages installed on top of
# it cannot come from different trees. backend.env used to carry it as a second,
# hand-moved pin whose stated MUST ("always the commit the release tag points
# at") nothing could check — and a pair that can disagree eventually does
# (objectui#7964, objectui#7689 for the version half).
#
# Annotated tags resolve in two lines: the tag object, then the peeled `^{}`
# commit. Take the peeled sha when present, else the tag's own (lightweight tags
# do not peel). Both patterns are passed explicitly — asking for the tag alone
# does NOT return its peeled line.
OBJECTSTACK_TAG="@objectstack/cli@$OBJECTSTACK_VERSION"
# GIT_TERMINAL_PROMPT=0 so an unreachable/private remote fails in seconds with
# the message below instead of blocking the job on a credential prompt.
if ! TAG_LINES="$(GIT_TERMINAL_PROMPT=0 git ls-remote --tags "$REPO_URL" \
    "refs/tags/$OBJECTSTACK_TAG" "refs/tags/$OBJECTSTACK_TAG^{}" 2>&1)"; then
  echo "[live-backend] cannot reach $REPO_URL to resolve the release tag" >&2
  echo "[live-backend] $TAG_LINES" >&2
  exit 1
fi
OBJECTSTACK_REF="$(printf '%s\n' "$TAG_LINES" | awk -v t="refs/tags/$OBJECTSTACK_TAG" '
  $2 == t "^{}" { peeled = $1 }
  $2 == t       { plain  = $1 }
  END { print (peeled != "" ? peeled : plain) }
')"
# A missing tag is not an error to `git ls-remote` — it prints nothing and exits
# 0 — so the shape check below is the actual guard, not a formality. Refuse
# loudly and by name: the alternative is `git fetch --depth 1 origin ""` failing
# 300 seconds downstream, in a log nobody reads until the job goes red.
if [[ ! "$OBJECTSTACK_REF" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[live-backend] release tag '$OBJECTSTACK_TAG' does not resolve to a commit in" >&2
  echo "[live-backend]   $REPO_URL" >&2
  echo "[live-backend] OBJECTSTACK_VERSION=$OBJECTSTACK_VERSION (backend.env) names a version" >&2
  echo "[live-backend] with no published release tag, or the tag scheme moved. Refusing to" >&2
  echo "[live-backend] start: there is no showcase-app commit matching that release." >&2
  exit 1
fi
echo "[live-backend] resolved $OBJECTSTACK_TAG -> $OBJECTSTACK_REF"

# The RESOLVED sha, not the version, is in the stamp: without it, a fixture
# prepared before a pin change satisfies the reuse test and the new pin is never
# installed — and a re-pointed tag is exactly such a change with no key of its
# own to hash. The workflow's fixture cache key is the hash of backend.env,
# which carries the version for the same reason; see the ⚠️ note there for the
# one path that key can no longer see. The third component is the install
# recipe's one override: that key hashes backend.env only, so a recipe change
# made in this script restores the old fixture on a hit, and this stamp is what
# rejects it. (The retired `better-auth` pin used to sit in the same slot.)
WANT_STAMP="$OBJECTSTACK_REF $OBJECTSTACK_VERSION vitest@$VITEST_OVERRIDE"

mkdir -p "$BACKEND_DIR"

prepare() {
  if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$WANT_STAMP" ] && [ -d "$APP_DIR/node_modules" ]; then
    echo "[live-backend] prepare: pins unchanged ($WANT_STAMP), reusing $APP_DIR"
    return
  fi
  echo "[live-backend] prepare: showcase@${OBJECTSTACK_REF:0:12} (from $OBJECTSTACK_TAG) on published @objectstack/*@$OBJECTSTACK_VERSION"
  rm -rf "$APP_DIR" "$BACKEND_DIR/src" "$STAMP"

  # Shallow, sparse fetch of the resolved commit — metadata source only.
  git init -q "$BACKEND_DIR/src"
  git -C "$BACKEND_DIR/src" remote add origin "$REPO_URL"
  git -C "$BACKEND_DIR/src" sparse-checkout set examples/app-showcase
  git -C "$BACKEND_DIR/src" fetch -q --depth 1 origin "$OBJECTSTACK_REF"
  git -C "$BACKEND_DIR/src" checkout -q FETCH_HEAD

  cp -R "$BACKEND_DIR/src/examples/app-showcase" "$APP_DIR"
  rm -rf "$BACKEND_DIR/src"

  # workspace:* -> the pinned published version; drop dev tooling the server
  # doesn't need (playwright/vitest/typescript — the CLI loads the TS config
  # itself). Keep non-@objectstack runtime deps (e.g. @modelcontextprotocol/sdk).
  # The only `overrides` entry written is VITEST_OVERRIDE (see its note above);
  # otherwise the published @objectstack/* manifests decide their own
  # transitive versions.
  node -e '
    const fs = require("fs");
    const file = process.argv[1], pin = process.argv[2], vitest = process.argv[3];
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const k of Object.keys(pkg.dependencies || {}))
      if (k.startsWith("@objectstack/")) pkg.dependencies[k] = pin;
    pkg.devDependencies = { "@objectstack/cli": pin };
    pkg.overrides = { ...pkg.overrides, vitest };
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  ' "$APP_DIR/package.json" "$OBJECTSTACK_VERSION" "$VITEST_OVERRIDE"

  (cd "$APP_DIR" && npm install --no-audit --no-fund --loglevel=error)
  echo "$WANT_STAMP" > "$STAMP"
}

start() {
  # Trust a recorded pid only if it is alive AND is actually an objectstack
  # process — the pid file can ride in from the CI cache, where the raw number
  # may collide with an unrelated process on a fresh runner.
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
  # so `$!` is the `objectstack dev` process itself (nohup and the bin's
  # `env node` shebang both exec in place); its SIGTERM takes down the `serve`
  # child that holds the port. Backgrounding `cd … && nohup …` as one list
  # forks a subshell and records ITS pid instead: stop-backend.sh then kills
  # that subshell and the server keeps the port, and the `already running`
  # check above never matches, because the subshell's cmdline is this script's
  # (objectui#12676, measured there at 18.0.0-next.2; nothing here re-derives).
  (cd "$APP_DIR"
    OS_CLOUD_URL=off nohup ./node_modules/.bin/objectstack dev \
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
