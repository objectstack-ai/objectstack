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
# Both modes then run the scaffolded project's own `build` script and assert it
# exits 0 — the step section 1b explains, and the one this gate used to lack.
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
# started declaring `allowBuilds` (#3119).
#
# Usage:
#   bash scripts/publish-smoke.sh
# Env:
#   SMOKE_MODE  pack | registry            (default: pack)
#   SMOKE_ROOT  work dir                   (default: mktemp -d)
#   SMOKE_KEEP  1 = keep work dir + logs   (default: 0, auto-clean)
#   SMOKE_PORT  dev-server port            (default: a free port per run)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_MODE="${SMOKE_MODE:-pack}"
# Empty = pick a free port per run, just before the boot. A caller who names a
# port gets exactly that port and no search — see the port block in section 2.
SMOKE_PORT="${SMOKE_PORT:-}"
SMOKE_KEEP="${SMOKE_KEEP:-0}"
SMOKE_ROOT="${SMOKE_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/objectstack-publish-smoke.XXXXXX")}"
APP_NAME="smoke-app"
APP_DIR="$SMOKE_ROOT/$APP_NAME"
# The namespace the bundled `blank` template ships with, i.e. the value the
# scaffolder rewrites AWAY from. APP_NAME must not derive to it — see the
# identity assertion in section 1b, which is what keeps that true on purpose.
TEMPLATE_NAMESPACE="blank"
SERVER_LOG="$SMOKE_ROOT/server.log"
SERVER_PID=""
# TMPDIR for the dev child ALONE. `--fresh` puts its ephemeral OS_HOME under the
# child's own `os.tmpdir()`, and the serve process publishes the port it really
# bound into a runtime state file there. Pinning that tmpdir to a directory this
# run created is what makes the file we read provably ours rather than a
# neighbouring run's — see smoke_wait_for_own_server.
DEV_TMPDIR="$SMOKE_ROOT/dev-tmp"
# Assigned only after the server reports the port it ACTUALLY bound; the port we
# request is a request, not a fact. localhost, not 127.0.0.1: the auth plugin's
# default trustedOrigins is a localhost wildcard, so a 127.0.0.1 origin draws a
# 403 INVALID_ORIGIN.
BASE_URL=""
BOUND_PORT=""

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
# ── collision safety between CONCURRENT RUNS ────────────────────────────
#
# Agent dispatch containers run several agents against one filesystem and one
# network namespace, so a fixed port is shared state between overlapping runs.
# The work dir and the server log above are already mktemp-qualified; the port
# was the one piece of per-run state still spelled as a literal.
#
# What makes the port worse than a shared log here is that `objectstack dev`
# AUTO-SHIFTS off a busy one. Measured, with a neighbour already holding 34217:
#
#     $ objectstack dev --port 34217 --fresh
#       ↪ server bound to port 34218 (requested 34217)
#     $ curl http://localhost:34217/api/v1/health
#     {"iam":"NEIGHBOUR-RUN-A", ...}                       ← HTTP 200, someone else
#     $ curl http://localhost:34218/api/v1/health
#     {"success":true,"data":{"status":"ok", ...}}          ← HTTP 200, ours
#
# packages/cli/src/commands/serve.ts gates that shift on `flags.dev`, which is
# exactly the path `objectstack dev` takes, so this script always gets it. The
# non-dev branch beside it refuses loudly instead — but opting into that refusal
# is not available to a caller (`dev` always spawns `serve --dev`), and changing
# the CLI to offer it is a contract change, not a fix for this script.
#
# The obvious countermeasure does NOT work, and that is the part worth spelling
# out. A liveness check on our own spawn — `kill -0 "$SERVER_PID"`, which this
# wait loop ALREADY had — answers "yes" throughout the measurement above: our
# server did not fail, it succeeded somewhere else. Picking a free port per run
# does not close it either, because the pick reserves nothing and the shift can
# still move us after it. So neither half of the sibling fix in
# scripts/gen-sdui-manifest.sh transfers unchanged: vite could be told
# `--strictPort`, and its wait loop had no liveness check to begin with.
#
# What does work is reading the port our own server actually bound. serve.ts
# publishes it ("Publish the actually-bound port": pid + port + url, written to
# a runtime state file under OS_HOME expressly so external supervisors never
# have to guess), `--fresh` puts that OS_HOME under the dev child's own tmpdir,
# and we pin that tmpdir to a directory this run created. So the file we read
# can only describe our own server, and BASE_URL is derived from where our app
# IS rather than from where we asked it to be.
#
# Rejected, with the measurement that rejected it: asserting on something unique
# to this run's scaffold instead of on the server we spawned. It would be the
# better assertion — it is what the smoke actually cares about — but there is no
# anonymous endpoint that carries the app's identity, so it cannot gate the
# readiness wait, which is the point where the wrong app has to be turned down.
# Measured against a booted app: `GET /api/v1/data/<this app's object>` and
# `GET /api/v1/data/no_such_object_zzz` both answer 401 UNAUTHENTICATED (the auth
# gate runs before routing), and `GET /api/v1/discovery` — which is anonymous —
# reports the constant `"name":"ObjectStack API"`, not the project. The first
# app-specific assertion available is the authenticated CRUD probe in section 3,
# which lands after the auth probes have already run against the wrong app.

# Print a TCP port that is free right now AND reserved for this caller,
# searching upward from $1.
#
# WHY A RESERVATION AND NOT JUST A PROBE.
#
# The probe below used to be the whole of this helper: bind a socket, CLOSE it,
# and report the port free. Between that close and `objectstack dev`'s own bind
# the port is unowned, and the scan is deterministic from $base upward, so every
# concurrent caller starting at the same base was handed the same number — a
# check-then-use race whose "use" is in another process, colliding by
# construction rather than by bad luck. Measured on this tree with the
# reservation removed, eight concurrent callers scanning from 3210:
#
#     DISTINCT_PORTS=1 of 8       # every one of them was handed 3210
#     BIND_OK=1  BIND_ERR=7       # seven lost the follow-up bind:
#                                 #   Error: listen EADDRINUSE :::3210
#
# The identical shape in scripts/gen-sdui-manifest.sh dequeued a PR from the
# merge queue (#10167, fixed in #10217 — this is the port of that fix). The
# contention here is not hypothetical either: the collision test beside this
# script draws from 3210 four times and the real path below draws once more, in
# a container several agents share.
#
# So a port is CLAIMED before it is probed, in a registry every caller on this
# host shares, and the claim outlives this function — it is released when the
# claiming process dies, not when this function returns. Two cooperating callers
# can no longer be handed the same port at all. The probe stays, because a claim
# says nothing about processes that never heard of this registry.
#
# STILL ADVISORY against those, and that half is deliberately unchanged: nothing
# here stops a process outside the registry from taking the port between this
# function and `objectstack dev`'s bind. smoke_wait_for_own_server is what turns
# losing that race into a warning and a correctly retargeted BASE_URL instead of
# a silent wrong answer — see the collision-safety block above, which is why
# this script never needed the loud-failure half the sdui fix relies on. What
# the claim removes is the collision this script's own callers cause each other,
# which is every collision anyone has actually measured here.
#
# Probes the wildcard address with no host argument, the same spelling
# serve.ts's own isPortAvailable() uses, so this sees a busy port exactly when
# the CLI would. (The sibling helper probes 127.0.0.1 because vite binds
# loopback; that difference is load-bearing in both directions and is why these
# two functions are ported rather than merged — see the registry note below.)
smoke_pick_free_port() {
  local base="${1:-3210}" span="${2:-200}"
  local dir="${SMOKE_PORT_RESERVATION_DIR:-${TMPDIR:-/tmp}/objectstack-port-reservations}"

  # `O_EXCL` alone already gives exactly one winner per port, so the lock is not
  # what makes a claim exclusive — it makes the SWEEP of abandoned claims safe,
  # which is the one step that unlinks a file another scanner may be creating.
  # Missing `flock` therefore degrades to "sound, minus the sweep's tie-break",
  # never to a hard failure: this script runs on developer machines too.
  #
  # The descriptor is opened by a subshell that exits before the dev server is
  # spawned, so nothing this script starts can inherit it. That matters more here
  # than it looks: `objectstack dev` leaves a `serve` child that outlives its
  # parent (see kill_tree above), and an inherited lock fd would keep the
  # registry locked by that orphan for the whole run.
  if command -v flock >/dev/null 2>&1; then
    (
      flock -w 30 9 2>/dev/null || true
      smoke_scan_and_reserve_port "$base" "$span"
    ) 9>"${dir}.lock"
  else
    smoke_scan_and_reserve_port "$base" "$span"
  fi
}

# The scan itself: claim, then probe, then hand the port over. Split out from
# `smoke_pick_free_port` only so the lock above wraps one named thing.
smoke_scan_and_reserve_port() {
  local base="$1" span="$2"
  node - "$base" "$span" "$$" <<'SMOKE_PICK_FREE_PORT'
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const base = Number(process.argv[2]);
const span = Number(process.argv[3]);
// The CALLER's pid, not this node process's: the caller is what will hold the
// port (it spawns `objectstack dev`), and its death is what makes the claim
// collectable. `$$` survives the command substitution this helper is called in,
// so it names the shell running the smoke, not a transient subshell.
const owner = Number(process.argv[4]);

// One registry per host, shared by every caller that sources this script —
// sharing it IS the fix, so the tests that measure contention deliberately do
// not override this. The override exists for tests of the protocol itself.
//
// The name is deliberately NOT script-specific. scripts/gen-sdui-manifest.sh
// runs the same protocol against its own directory today; the two draw from
// disjoint bases (3210 here, 5180 there), so they cannot collide with each
// other and nothing is lost by that split right now. Converging both onto this
// neutral default — and then onto one shared helper — is the follow-up, and it
// is a pure rename on that side because the on-disk format is identical:
// filename is the port, contents are the owner pid.
const dir =
  process.env.SMOKE_PORT_RESERVATION_DIR ||
  path.join(process.env.TMPDIR || os.tmpdir(), 'objectstack-port-reservations');

// A claim is collectable once its owner is gone. The floor keeps a claim
// written moments ago out of the sweep whatever its pid says; the ceiling is a
// backstop for the case pid liveness cannot see — a dead owner whose pid number
// has since been reused by something unrelated.
const SWEEP_FLOOR_MS = 10_000;
const SWEEP_CEILING_MS = 12 * 60 * 60 * 1000;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // it exists, it is simply not ours to signal
  }
};

const sweep = () => {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const file = path.join(dir, name);
    let holder;
    let age;
    try {
      holder = Number(String(fs.readFileSync(file, 'utf8')).trim());
      age = now - fs.statSync(file).mtimeMs;
    } catch {
      continue; // vanished under us — someone else already collected it
    }
    if (age < SWEEP_FLOOR_MS) continue;
    if (age < SWEEP_CEILING_MS && Number.isInteger(holder) && holder > 0 && alive(holder)) continue;
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
};

// `wx` is O_CREAT|O_EXCL: exactly one creator wins, and the losers are told so
// HERE rather than discovering it at bind time in another process.
const claim = (port) => {
  try {
    fs.writeFileSync(path.join(dir, String(port)), `${owner}\n`, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
};

const release = (port) => {
  try {
    fs.unlinkSync(path.join(dir, String(port)));
  } catch {
    /* already gone */
  }
};

// No host argument: the wildcard bind is the spelling serve.ts's own
// isPortAvailable() uses, so a port this rejects is a port the CLI would too.
const isFree = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  sweep();
  for (let port = base; port < base + span; port += 1) {
    // Claimed by a live caller — including by an earlier call from THIS caller,
    // which is why two picks in one run cannot return one port.
    if (!claim(port)) continue;
    if (await isFree(port)) {
      process.stdout.write(String(port));
      return;
    }
    // Held by something outside the registry. Hand the claim back rather than
    // hoarding a port we never got, and keep scanning.
    release(port);
  }
  process.stderr.write(`no free TCP port in [${base}, ${base + span})\n`);
  process.exitCode = 1;
})();
SMOKE_PICK_FREE_PORT
}

# The argv the dev server runs under, one word per line — `env` and its
# assignments included, because the TMPDIR pin is part of the invocation and not
# a detail of it.
#
# A function rather than an inline command line so that pin is assertable by
# SOURCING this file, instead of only by grepping it. A grep assertion would also
# pass against a version that names TMPDIR in a comment and nowhere else, which
# is precisely the regression this guards.
smoke_dev_server_argv() {
  printf '%s\n' env NO_COLOR=1 "TMPDIR=$DEV_TMPDIR" \
    ./node_modules/.bin/objectstack dev --port "$SMOKE_PORT" --fresh
}

# Wait until the dev server THIS RUN started is healthy, and set BOUND_PORT to
# the port it is actually answering on. $1 = probe count (2s apart).
#
# Ordering is load-bearing. The runtime state file is read BEFORE anything is
# curled, because a neighbouring run's server answers 200 on the requested port
# exactly like ours would — "the port answers" is no evidence at all. And the
# liveness check is repeated AFTER a successful curl, because ours can exit
# between the read and the probe and leave the port to whoever grabs it next.
smoke_wait_for_own_server() {
  local timeout="$1" i f runtime_file bound saw_runtime=0
  for i in $(seq 1 "$timeout"); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      fail "dev server exited before becoming healthy"
    fi
    runtime_file=""
    for f in "$DEV_TMPDIR"/objectstack-dev-*/runtime.*.json; do
      if [ -f "$f" ]; then runtime_file="$f"; break; fi
    done
    if [ -n "$runtime_file" ]; then
      saw_runtime=1
      bound=$(jq -er '.port | numbers' "$runtime_file" 2>/dev/null || true)
      if [ -n "$bound" ] && curl -fsS "http://localhost:$bound/api/v1/health" >/dev/null 2>&1; then
        kill -0 "$SERVER_PID" 2>/dev/null \
          || fail "dev server exited while its port was being probed"
        BOUND_PORT="$bound"
        echo "  healthy after probe #$i — our server is on port $BOUND_PORT"
        return 0
      fi
    fi
    sleep 2
  done
  if [ "$saw_runtime" = "0" ]; then
    fail "dev server never published a runtime state file under $DEV_TMPDIR (expected objectstack-dev-*/runtime.*.json, written by packages/cli/src/commands/serve.ts). Without it this script cannot tell its own server from a concurrent run's on the same port, and refuses to guess."
  fi
  fail "dev server published port $bound but never answered there within $((timeout * 2))s"
}

# Sourcing this file defines the helpers above and runs nothing. `${BASH_SOURCE[0]}`
# differs from `$0` exactly when the file is sourced, which is how the collision
# test drives the real functions instead of grepping for them — a grep passes
# against a version that only mentions the behaviour in a comment.
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  return 0
fi

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
  # the whole file, declaring the approvals itself — which is exactly how #3119
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

  # Diagnostics for the ERR_PNPM_IGNORED_BUILDS failure class (#3124). The
  # scaffolded app declares NO packageManager field (deliberately — see the
  # header), so the `pnpm` that runs HERE is NOT this repo's pinned 10.31.0:
  # with corepack enabled, corepack resolves the LATEST pnpm for a directory
  # with no pin (11.x today). That divergence is the whole reason #3124's local
  # repro (pnpm 10.31/10.33 both honor the allowlist) never reproduced the CI
  # red — CI runs a stricter pnpm major. Print the resolved version, the
  # build-approval config pnpm actually parsed, and the file it parsed it from,
  # so any future red run answers "which pnpm, and did it see the approvals?"
  # on its own. Never let a diagnostic fail the smoke (|| true).
  log "pnpm environment inside the app (no packageManager pin — corepack resolves latest)"
  ( cd "$APP_DIR"
    echo "  pnpm --version: $(pnpm --version 2>&1)"
    echo "  build-approval config pnpm resolved (onlyBuiltDependencies):"
    pnpm config list 2>/dev/null | grep -iE 'only-built|built-dependencies|strict-dep-builds' | sed 's/^/    /' \
      || echo "    (no build-related config keys reported)"
    echo "  pnpm-workspace.yaml as written:"
    sed 's/^/    /' pnpm-workspace.yaml
  ) || true

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

# ── 1b. verify identity, then build ─────────────────────────────────────────
# THE BUILD STEP. `npm run build` is the second command the scaffolder prints,
# and it is where every "published scaffold is broken" incident so far actually
# surfaced: #4902 (all five remote templates at once), #7644 (the namespace
# rewrite on 16.1.0) and #8677 (retired enable.trash/enable.mru on 17.0.0). In
# every one of them scaffold and install both exited 0 and only the build
# exited 2 — so a smoke that went straight from install to `objectstack dev`,
# as this one did, was structurally unable to see any of them. Scheduled run
# #1932 concluded SUCCESS on 2026-08-10 against a published create-objectstack
# whose scaffold failed first build on four templates: that green was honest,
# and it meant nothing.
#
# Cost, measured on GA 17.0.0 (Node 22.22.2 / npm 10.9.7): scaffold 2s,
# install 60s, build 3s. The install was already here, so the ADDED cost of
# this coverage is ~3s against a job budgeted 25 minutes. The "five extra
# installs" the issue weighed was the cost of the five-template loop, which is
# moot: the five remote templates were delisted and unmaintained, and the
# scaffolder's catalog is `blank` alone (packages/create-objectstack/src/
# template-registry.ts). Scope here is `blank` for the same reason — it is the
# whole supported surface, and the entire first-run experience for a new user.
log "Verifying the scaffolded project's identity"
[ -f "$APP_DIR/objectstack.config.ts" ] \
  || fail "scaffolded project has no objectstack.config.ts — cannot read its namespace"

# The project's namespace MUST differ from the template's own. That is
# load-bearing, not cosmetic: the scaffolder's identity rewrite only does
# anything when the two differ, and #7644 was precisely a rewrite that silently
# did nothing. Measured both ways against the #7644 state
# (create-objectstack@16.1.0): with the two different, the build reports 4
# "missing the package namespace prefix" errors and exits 2; with the project
# named after the template, the same defect yields 0 such errors and that whole
# class goes invisible. APP_NAME differing from the template namespace was
# accidental before this line — now it is asserted.
PROJECT_NAMESPACE=$(sed -nE "s/.*namespace:[[:space:]]*['\"\`]([a-z0-9_]+)['\"\`].*/\1/p" \
  "$APP_DIR/objectstack.config.ts" | head -1)
[ -n "$PROJECT_NAMESPACE" ] \
  || fail "could not read a namespace from $APP_DIR/objectstack.config.ts"
if [ "$PROJECT_NAMESPACE" = "$TEMPLATE_NAMESPACE" ]; then
  fail "scaffolded namespace '$PROJECT_NAMESPACE' equals the template's own — the identity rewrite is a no-op, so the #7644 defect class cannot reproduce and this gate would be blind to it. Change APP_NAME so the two differ."
fi
echo "  ok — namespace '$PROJECT_NAMESPACE' differs from the template's '$TEMPLATE_NAMESPACE'"

# pack mode installed with pnpm, registry mode with npm — build with whichever
# package manager owns that project's node_modules.
if [ "$SMOKE_MODE" = "pack" ]; then BUILD_PM="pnpm"; else BUILD_PM="npm"; fi

# Absence must be loud: if the template stops shipping a build script, the run
# below fails with a package-manager "missing script" message that says nothing
# about the template. Name the real remedy instead.
jq -e '.scripts.build | strings' "$APP_DIR/package.json" >/dev/null 2>&1 \
  || fail "the scaffolded project declares no 'build' script — the first-run path its own output tells the user to run does not exist. Fix the create-objectstack template, not this script."

log "Building the scaffolded project ($BUILD_PM run build) — the #7644/#8677 failure point"
if ! (cd "$APP_DIR" && env NO_COLOR=1 "$BUILD_PM" run build); then
  fail "'$BUILD_PM run build' failed in the scaffolded project — a fresh install cannot complete the documented first-run path. This is the #4902/#7644/#8677 failure class."
fi

# Exit 0 alone is not the assertion: a build that emits nothing would satisfy
# it while leaving `objectstack start` with no artifact to serve.
[ -f "$APP_DIR/dist/objectstack.json" ] \
  || fail "'$BUILD_PM run build' exited 0 but produced no dist/objectstack.json — a build that emits nothing is a false green"
echo "  ok — built dist/objectstack.json ($(wc -c < "$APP_DIR/dist/objectstack.json") bytes)"

# ── 2. boot the dev server ──────────────────────────────────────────────────
# --fresh: ephemeral OS_HOME + sqlite DB + seeded admin
# (admin@objectos.ai / admin123) — no first-run wizard to block on.
# The port, resolved as late as possible so the free-port probe and the bind it
# informs are as close together as they can be. An explicit SMOKE_PORT is passed
# through UNCHANGED and never searched around: a caller who names a port is
# making a request this script has no business quietly re-deciding. The CLI can
# still shift off it — the warning below says so out loud when it does.
if [ -n "$SMOKE_PORT" ]; then
  echo "  SMOKE_PORT=$SMOKE_PORT — using it exactly, no per-run search"
else
  SMOKE_PORT="$(smoke_pick_free_port 3210 || true)"
  case "$SMOKE_PORT" in
    '' | *[!0-9]*) fail "could not find a free TCP port for this run's dev server" ;;
  esac
fi

log "Starting objectstack dev (requested port $SMOKE_PORT)"
mkdir -p "$DEV_TMPDIR"
# NO_COLOR: some loggers colorize even without a TTY; ANSI codes around
# "ERROR" would slip through the log scan below (they did — see the escaped
# `\x1b[31m…ERROR…` line the negative test produced).
# TMPDIR: see the collision-safety block — it is what makes the runtime state
# file this run reads back provably its own.
mapfile -t DEV_ARGV < <(smoke_dev_server_argv)
(cd "$APP_DIR" && exec "${DEV_ARGV[@]}") \
  > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

smoke_wait_for_own_server 60

if [ "$BOUND_PORT" != "$SMOKE_PORT" ]; then
  # Not fatal: our app is up and healthy, it is simply not where we asked. Every
  # probe below now targets it correctly, which is the whole point. What IS
  # newsworthy is the neighbour — before this diagnostic existed, the run went on
  # to smoke-test whatever was holding the requested port and reported on it.
  printf '\n⚠ objectstack dev auto-shifted: requested %s, bound %s.\n' "$SMOKE_PORT" "$BOUND_PORT"
  printf '   Something else is holding %s — most likely a concurrent publish-smoke run.\n' "$SMOKE_PORT"
  printf '   Smoking THIS run'"'"'s server on %s; whatever answers on %s is not ours.\n' "$BOUND_PORT" "$SMOKE_PORT"
fi
BASE_URL="http://localhost:$BOUND_PORT"

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
