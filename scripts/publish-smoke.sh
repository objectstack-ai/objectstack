#!/usr/bin/env bash
# Publish-artifact smoke — prove the first-run experience works on the exact
# package combination a user would install, BEFORE it is published.
#
# Why (issue #3091): pnpm overrides in pnpm-workspace.yaml do NOT ship with
# published packages. 15.1.0 was fully green in-repo (every job ran the
# overridden better-auth 1.7.0-rc.1) while every fresh `npx create-objectstack`
# project resolved plugin-auth's own declared ranges to an untested mix that
# 500'd every auth endpoint. The static half of the fix is
# scripts/check-override-consistency.mjs (#3085); this is the dynamic half:
# actually install what a user gets and drive auth + CRUD end-to-end.
#
# Modes (SMOKE_MODE):
#   pack      (default) `pnpm pack` every publishable package, scaffold a
#             fresh project with the repo-built create-objectstack, and pin
#             every @objectstack/* to the local tarballs via the project's OWN
#             pnpm overrides. The project lives outside this workspace and
#             deliberately inherits none of its pnpm-workspace.yaml overrides
#             — exactly like a downstream install of the release candidate.
#             Prereq: `pnpm install` + `pnpm build` (dist/ everywhere).
#   registry  scaffold with the PUBLISHED create-objectstack@latest and
#             npm-install straight from the npm registry — the new-user canary
#             that catches ^-range drift breaking already-published versions.
#             Needs no repo build; only this script.
#
# Both modes then boot `objectstack dev --fresh` and assert:
#   - GET  /api/v1/auth/get-session        → 200   (anonymous)
#   - POST /api/v1/auth/sign-up/email      → 200
#   - POST /api/v1/auth/sign-in/email      → 200, session established
#   - REST CRUD on the scaffolded object (POST/GET/PATCH/DELETE /api/v1/data/…)
#   - zero error/fatal log lines (specifically the #3091 signature:
#     "Failed to register OIDC discovery routes")
#
# better-sqlite3 is an optionalDependency of @objectstack/driver-sql: if the
# runner cannot build the native addon the install still succeeds and the
# runtime falls back to the WASM sqlite driver (#2229) — the smoke must never
# be blocked on node-gyp.
#
# pnpm version: deliberately NOT pinned in the scaffolded project. This repo's
# `packageManager` pin applies to this checkout, not to a project outside it,
# so corepack resolves the LATEST pnpm there — which is what a user on a fresh
# machine gets, and therefore what this gate must test. Stamping packageManager
# into the generated app would buy reproducibility by testing a pnpm nobody
# downstream runs: the same "in-repo settings hide the user's real resolution"
# mistake that #3091 was, in a new costume. The tradeoff is real — a new pnpm
# major can turn this red with no code change here — but that is signal, not
# noise: it means a fresh install is broken for new users and the
# create-objectstack template needs updating. It has already happened once:
# pnpm 11 turned unapproved build scripts from a warning into a hard error, so
# every `npx create-objectstack` + `pnpm install` exited 1 until the template
# started declaring `allowBuilds` (#3110).
#
# Usage:
#   bash scripts/publish-smoke.sh
# Env:
#   SMOKE_MODE  pack | registry            (default: pack)
#   SMOKE_ROOT  work dir                   (default: mktemp -d)
#   SMOKE_KEEP  1 = keep work dir + logs   (default: 0, auto-clean)
#   SMOKE_PORT  dev-server port            (default: 3210)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_MODE="${SMOKE_MODE:-pack}"
SMOKE_PORT="${SMOKE_PORT:-3210}"
SMOKE_KEEP="${SMOKE_KEEP:-0}"
SMOKE_ROOT="${SMOKE_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/objectstack-publish-smoke.XXXXXX")}"
APP_NAME="smoke-app"
APP_DIR="$SMOKE_ROOT/$APP_NAME"
# localhost, not 127.0.0.1: the auth plugin's default trustedOrigins is a
# localhost wildcard, so a 127.0.0.1 origin draws a 403 INVALID_ORIGIN.
BASE_URL="http://localhost:$SMOKE_PORT"
SERVER_LOG="$SMOKE_ROOT/server.log"
SERVER_PID=""

log()  { printf '\n== %s\n' "$*"; }
fail() { printf '::error::%s\n' "$*" >&2; exit 1; }

command -v jq >/dev/null || fail "jq is required"
command -v curl >/dev/null || fail "curl is required"

# ── cleanup ─────────────────────────────────────────────────────────────────
# `objectstack dev` spawns a `serve` child that outlives its parent when the
# parent is killed, so tear down the whole process tree, leaves first.
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  local code=$?
  if [ -n "$SERVER_PID" ]; then
    kill_tree "$SERVER_PID"
  fi
  if [ "$code" -ne 0 ] && [ -f "$SERVER_LOG" ]; then
    printf '\n── server.log (tail) ─────────────────────────────\n'
    tail -n 200 "$SERVER_LOG" || true
  fi
  if [ "$SMOKE_KEEP" = "1" ]; then
    printf '\nSMOKE_KEEP=1 — work dir preserved: %s\n' "$SMOKE_ROOT"
  else
    rm -rf "$SMOKE_ROOT"
  fi
  exit "$code"
}
trap cleanup EXIT

# ── 1. obtain the project ───────────────────────────────────────────────────
mkdir -p "$SMOKE_ROOT"

if [ "$SMOKE_MODE" = "pack" ]; then
  [ -d "$REPO_ROOT/packages/cli/dist" ] || fail "packages/cli/dist missing — run 'pnpm build' first"
  [ -f "$REPO_ROOT/packages/create-objectstack/bin/create-objectstack.js" ] \
    || fail "create-objectstack bin missing — run 'pnpm build' first"

  log "Packing publishable packages (pnpm pack == publish-time manifests)"
  node "$REPO_ROOT/scripts/publish-smoke-pack.mjs" "$SMOKE_ROOT/tarballs"

  log "Scaffolding $APP_NAME with the repo-built create-objectstack"
  (cd "$SMOKE_ROOT" && node "$REPO_ROOT/packages/create-objectstack/bin/create-objectstack.js" \
    "$APP_NAME" --skip-install --skip-skills)

  # The project is its own workspace root: having a pnpm-workspace.yaml at all
  # stops pnpm walking up, so it never inherits this repo's settings. We APPEND
  # the tarball pins to the file the TEMPLATE ships rather than writing our own.
  #
  # Appending, not overwriting, is load-bearing: the template's build-approval
  # block (allowBuilds / onlyBuiltDependencies) is part of what a user gets, so
  # it has to be part of what this gate tests. This script used to hand-write
  # the whole file, declaring the approvals itself — which is exactly how #3110
  # stayed invisible here: a locally-authored declaration proves nothing about
  # what the template ships.
  #
  # Anything NOT in the override map (transitive deps, better-auth, hono, …)
  # resolves from the registry exactly as it would for a real user; that
  # unpinned resolution is the thing under test.
  log "Pinning @objectstack/* to local tarballs via project-local overrides"
  node - "$SMOKE_ROOT/tarballs/overrides.json" "$APP_DIR/pnpm-workspace.yaml" <<'EOF'
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const [overridesPath, wsPath] = process.argv.slice(2);
const overrides = JSON.parse(readFileSync(overridesPath, 'utf8'));

// Whatever the template shipped stays verbatim; we only add `overrides:`.
const base = existsSync(wsPath) ? readFileSync(wsPath, 'utf8').replace(/\s*$/, '') : '';

// Fail here rather than let pnpm fail cryptically 200 lines later: no build
// approvals means a fresh `pnpm install` exits 1 on pnpm 11 for every user.
if (!/^\s*(allowBuilds|onlyBuiltDependencies)\s*:/m.test(base)) {
  console.error(
    '::error::the scaffolded project declares no pnpm build approvals ' +
      '(allowBuilds / onlyBuiltDependencies). A fresh `pnpm install` will exit 1 ' +
      'on pnpm 11. Fix the create-objectstack template — not this script.',
  );
  process.exit(1);
}

const lines = [
  base,
  '',
  '# ── appended by scripts/publish-smoke.sh ─────────────────────────────────',
  '# @objectstack/* pinned to the about-to-publish tarballs; everything above',
  '# is what the template ships, everything else resolves from the registry.',
  'overrides:',
  ...Object.entries(overrides).map(([name, spec]) => `  '${name}': '${spec}'`),
];
writeFileSync(wsPath, lines.join('\n') + '\n');
console.log(
  `  wrote ${wsPath} (${Object.keys(overrides).length} overrides, template settings preserved)`,
);
EOF

  log "Installing (pnpm, tarball-pinned)"
  (cd "$APP_DIR" && pnpm install --no-frozen-lockfile)

  # Belt-and-braces: if any @objectstack/* resolved from the REGISTRY the
  # override map has a hole and the smoke would silently test published code.
  # Registry-resolved lockfile keys read '@objectstack/<name>@<version>';
  # tarball-pinned ones read '@objectstack/<name>@file:…' (with possible
  # peer suffixes containing their own @<version>, hence the [^'@] name part).
  log "Asserting no @objectstack/* leaked to the registry"
  if grep -En "'@objectstack/[^'@]+@[0-9]" "$APP_DIR/pnpm-lock.yaml"; then
    fail "some @objectstack/* packages resolved from the registry (see above) — publish-smoke-pack.mjs override map is incomplete"
  fi
  TARBALL_COUNT=$(grep -cE "'@objectstack/[^'@]+@file:" "$APP_DIR/pnpm-lock.yaml" || true)
  echo "  ok — $TARBALL_COUNT tarball-resolved @objectstack/* lockfile entries"
else
  log "Scaffolding $APP_NAME with published create-objectstack@latest"
  (cd "$SMOKE_ROOT" && npx -y create-objectstack@latest "$APP_NAME" --skip-install --skip-skills)

  log "Installing from the npm registry (npm — the default new-user path)"
  (cd "$APP_DIR" && npm install --no-fund --no-audit)
fi

# Diagnostic breadcrumb for the #3091 failure class: show which better-auth
# family versions the DOWNSTREAM resolution actually picked.
log "Resolved better-auth family:"
if [ -d "$APP_DIR/node_modules/.pnpm" ]; then
  ls "$APP_DIR/node_modules/.pnpm" | grep -E '^(better-auth|@better-auth\+)' | sed 's/^/  /' || echo "  (none found)"
else
  (cd "$APP_DIR" && npm ls better-auth "@better-auth/core" --all 2>/dev/null | sed 's/^/  /') || true
fi

# ── 2. boot the dev server ──────────────────────────────────────────────────
# --fresh: ephemeral OS_HOME + sqlite DB + seeded admin
# (admin@objectos.ai / admin123) — no first-run wizard to block on.
log "Starting objectstack dev (port $SMOKE_PORT)"
# NO_COLOR: some loggers colorize even without a TTY; ANSI codes around
# "ERROR" would slip through the log scan below (they did — see the escaped
# `\x1b[31m…ERROR…` line the negative test produced).
(cd "$APP_DIR" && exec env NO_COLOR=1 ./node_modules/.bin/objectstack dev --port "$SMOKE_PORT" --fresh) \
  > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for i in $(seq 1 60); do
  if curl -fsS "$BASE_URL/api/v1/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail "dev server exited before becoming healthy"
  fi
  [ "$i" = 60 ] && fail "dev server not healthy after 120s"
  sleep 2
done
echo "  healthy after probe #$i"

# ── 3. probes ───────────────────────────────────────────────────────────────
COOKIES_USER="$SMOKE_ROOT/cookies-user.txt"
COOKIES_ADMIN="$SMOKE_ROOT/cookies-admin.txt"
BODY="$SMOKE_ROOT/body.json"

# probe <label> <expected-status> <curl args…> — body lands in $BODY.
probe() {
  local label=$1 expect=$2; shift 2
  local status
  status=$(curl -sS -o "$BODY" -w '%{http_code}' "$@") || fail "$label: curl failed"
  if [ "$status" != "$expect" ]; then
    printf '── response body ──\n%s\n' "$(cat "$BODY")" >&2
    fail "$label: expected HTTP $expect, got $status"
  fi
  echo "  ok — $label → $status"
}

log "Auth probes (the #3091 failure surface)"
probe "GET /auth/get-session (anonymous)" 200 "$BASE_URL/api/v1/auth/get-session"

probe "POST /auth/sign-up/email" 200 \
  -X POST -H 'content-type: application/json' \
  -d '{"name":"Smoke User","email":"smoke@example.com","password":"Sm0ke-Pass!42"}' \
  "$BASE_URL/api/v1/auth/sign-up/email"

probe "POST /auth/sign-in/email" 200 \
  -c "$COOKIES_USER" \
  -X POST -H 'content-type: application/json' \
  -d '{"email":"smoke@example.com","password":"Sm0ke-Pass!42"}' \
  "$BASE_URL/api/v1/auth/sign-in/email"

probe "GET /auth/get-session (signed in)" 200 -b "$COOKIES_USER" "$BASE_URL/api/v1/auth/get-session"
jq -e '.user.email == "smoke@example.com"' "$BODY" >/dev/null \
  || fail "signed-in get-session did not return the smoke user (body: $(cat "$BODY"))"

log "REST CRUD probes (seeded dev admin)"
probe "POST /auth/sign-in/email (admin)" 200 \
  -c "$COOKIES_ADMIN" \
  -X POST -H 'content-type: application/json' \
  -d '{"email":"admin@objectos.ai","password":"admin123"}' \
  "$BASE_URL/api/v1/auth/sign-in/email"

# The scaffolder renames the template's `blank_note` object after the project
# (e.g. smoke_app_note) — read the real name from the generated source.
NOTE_OBJECT=$(node -e "
  const src = require('fs').readFileSync('$APP_DIR/src/objects/note.object.ts', 'utf8');
  const m = /name:\s*'([a-z0-9_]+)'/.exec(src);
  if (!m) { console.error('object name not found'); process.exit(1); }
  console.log(m[1]);
")
echo "  scaffolded object: $NOTE_OBJECT"

probe "POST /data/$NOTE_OBJECT (create)" 201 \
  -b "$COOKIES_ADMIN" \
  -X POST -H 'content-type: application/json' \
  -d '{"title":"publish smoke"}' \
  "$BASE_URL/api/v1/data/$NOTE_OBJECT"
RECORD_ID=$(jq -r '.id // .data.id // empty' "$BODY")
[ -n "$RECORD_ID" ] || fail "create response carried no record id (body: $(cat "$BODY"))"

probe "GET /data/$NOTE_OBJECT/$RECORD_ID (read)" 200 \
  -b "$COOKIES_ADMIN" "$BASE_URL/api/v1/data/$NOTE_OBJECT/$RECORD_ID"

probe "PATCH /data/$NOTE_OBJECT/$RECORD_ID (update)" 200 \
  -b "$COOKIES_ADMIN" \
  -X PATCH -H 'content-type: application/json' \
  -d '{"title":"publish smoke (updated)"}' \
  "$BASE_URL/api/v1/data/$NOTE_OBJECT/$RECORD_ID"

probe "DELETE /data/$NOTE_OBJECT/$RECORD_ID (delete)" 200 \
  -b "$COOKIES_ADMIN" \
  -X DELETE "$BASE_URL/api/v1/data/$NOTE_OBJECT/$RECORD_ID"

# ── 4. log scan ─────────────────────────────────────────────────────────────
# The #3091 breakage announced itself at startup ("Failed to register OIDC
# discovery routes") and would have been caught by ANY error-level line.
# Three error formats coexist: ConsoleLogger `[error] …`, JsonLogger
# `"level":"error"`, and timestamped `<ISO> ERROR …` (better-auth's logger and
# the auth plugin's startup reporting). ANSI codes are stripped first —
# belt-and-braces with NO_COLOR above, so a colorized ERROR can't slip through.
log "Scanning server log for error-level output"
SCRUBBED_LOG="$SMOKE_ROOT/server.scrubbed.log"
sed -e $'s/\x1b\\[[0-9;]*m//g' "$SERVER_LOG" > "$SCRUBBED_LOG"
if grep -nE '^\[(error|fatal)\]|"level":"(error|fatal)"|^\S+Z ERROR |Failed to register OIDC discovery routes' "$SCRUBBED_LOG"; then
  fail "error-level log lines during the smoke (see above)"
fi
echo "  ok — no error/fatal log lines"

log "Publish smoke passed ($SMOKE_MODE mode)"
