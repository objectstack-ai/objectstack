#!/usr/bin/env bash
# ADR-0080/0081: generate the public-tier SDUI component manifest and ratchet the
# spec↔frontend react-block conformance.
#
# This is deliberately SEPARATE from build-console.sh and is NOT part of the
# default build. The console component registry is a browser app (plugin-map /
# charts pull browser-only deps), so the only reliable way to enumerate it is to
# load the built `manifest-dump.html` in a real browser and read
# `window.__MANIFEST`. We do not want every console rebuild to drag in a
# Playwright browser dependency, so this step is opt-in / on-demand:
#
#   pnpm objectui:build      # (re)build + vendor the console dist at .objectui-sha
#   pnpm sdui:manifest       # then dump the manifest + ratchet conformance
#
# Requires a matching Playwright browser. If it complains the executable is
# missing, install it:
#
#   pnpm exec playwright install chromium-headless-shell
#
# Output: packages/console/dist/sdui.manifest.json  (consumed by the os-build
# JSX gate for full component/prop validation; absent -> gate falls back to
# parse-level).

set -euo pipefail

# ---------------------------------------------------------------------------
# Background dev-server lifecycle.
#
# WHY THIS IS NOT JUST `cmd & ...; trap 'kill $!' EXIT`.
#
# That is what this script used to do, and it was measured failing: the trap
# ran, and the backgrounded process was still alive 20 minutes later, holding
# the container's shared heavy-verify flock. Three separate properties of the
# naive form are wrong, and each one is enough on its own:
#
#   1. `$!` is the `pnpm` wrapper, and killing it does not reap the tree.
#      Measured here: SIGTERM to the wrapper leaves descendants reparented to
#      init (PPID 1) that no `kill "$!"` can ever reach. Signalling the process
#      GROUP is what reaches them.
#
#   2. You cannot signal the group without `setsid` first. A background job in
#      a non-interactive shell does NOT get its own process group — it inherits
#      the script's. Measured under agent discipline, the backgrounded server's
#      PGID was the PID of the wrapping `flock` itself, so the "obvious" fix,
#      `kill -- -$PGID`, would have killed the caller's flock and this script.
#      `setsid` gives the server its own session so the group kill is bounded.
#
#   3. Background children inherit open descriptors, and `flock(1)` holds its
#      lock on an open fd. Measured: the backgrounded wrapper carried the
#      caller's lock fd (`fuser -v` listed it as a holder), which is what turns
#      "a leaked dev server" into "every later agent in this container queues
#      out at exit 99 with no signal". Closing inherited fds in the child means
#      a kill that misses is merely untidy instead of a container-wide outage.
#
# A note on what was NOT determined: the exact reason the original SIGTERM
# failed to reap that particular run is not reproducible from here (it needs a
# real vite under a real console build tree). So the cleanup below is
# deliberately cause-agnostic — it escalates TERM -> KILL, it VERIFIES, and it
# says so loudly when it cannot finish the job, rather than assuming any one
# diagnosis. A cleanup that can fail silently is the whole defect.
# ---------------------------------------------------------------------------

SDUI_HAVE_SETSID=0
if command -v setsid > /dev/null 2>&1; then SDUI_HAVE_SETSID=1; fi

# Every pid in the session led by $1 (setsid path), or $1 plus its descendants
# (fallback path). Prints nothing when the tree is gone.
sdui_live_pids() {
  local leader="$1" out=""
  if [[ "$SDUI_HAVE_SETSID" == 1 ]]; then
    out="$(pgrep -s "$leader" 2>/dev/null || true)"
  else
    kill -0 "$leader" 2>/dev/null && out="$leader"
    local frontier="$leader" next=""
    while [[ -n "$frontier" ]]; do
      next="$(pgrep -P "${frontier// /,}" 2>/dev/null || true)"
      [[ -z "$next" ]] && break
      out="${out}${out:+ }${next//$'\n'/ }"
      frontier="${next//$'\n'/ }"
    done
  fi
  printf '%s' "$out" | tr '\n' ' ' | tr -s ' '
}

# Start "$@" detached: its own session (so the group is safe to signal) and no
# inherited descriptors above stderr (so an orphan cannot hold a caller's lock).
# Writes the leader pid to $1.
sdui_spawn_detached() {
  local pidfile="$1" logfile="$2"; shift 2
  : > "$pidfile"

  # Runs as the new session leader, before exec'ing the real command.
  local runner='
pidfile="$1"; shift
printf "%s\n" "$$" > "$pidfile"
if [ -d "/proc/$$/fd" ]; then
  for fd in /proc/$$/fd/*; do
    n=${fd##*/}
    # 0/1/2 are this job'"'"'s own stdio; 255 is reserved by bash itself.
    case "$n" in 0|1|2|255) continue ;; esac
    eval "exec ${n}>&-" 2>/dev/null || true
  done
fi
exec "$@"
'
  if [[ "$SDUI_HAVE_SETSID" == 1 ]]; then
    setsid bash -c "$runner" sdui-dump "$pidfile" "$@" < /dev/null > "$logfile" 2>&1 &
  else
    bash -c "$runner" sdui-dump "$pidfile" "$@" < /dev/null > "$logfile" 2>&1 &
  fi

  local _i
  for _i in $(seq 1 100); do
    [[ -s "$pidfile" ]] && return 0
    sleep 0.05
  done
  echo "⚠ dev server did not report its pid within 5s — cleanup may be incomplete." >&2
  return 0
}

# Stop what sdui_spawn_detached started, and VERIFY. Idempotent.
sdui_stop_detached() {
  local pidfile="${1:-}" leader="" sig="" left="" _i
  [[ -n "$pidfile" && -s "$pidfile" ]] && leader="$(tr -d '[:space:]' < "$pidfile" 2>/dev/null || true)"
  [[ -n "$pidfile" ]] && rm -f "$pidfile" 2>/dev/null || true
  case "$leader" in ''|*[!0-9]*) return 0 ;; esac

  for sig in TERM KILL; do
    left="$(sdui_live_pids "$leader")"
    [[ -z "${left// /}" ]] && return 0
    if [[ "$SDUI_HAVE_SETSID" == 1 ]]; then
      kill -"$sig" -- "-$leader" 2>/dev/null || true
    else
      # shellcheck disable=SC2086
      kill -"$sig" $left 2>/dev/null || true
    fi
    for _i in $(seq 1 40); do
      left="$(sdui_live_pids "$leader")"
      [[ -z "${left// /}" ]] && return 0
      sleep 0.25
    done
  done

  left="$(sdui_live_pids "$leader")"
  if [[ -n "${left// /}" ]]; then
    echo "✗ could not stop the SDUI dump dev server; these processes survived SIGKILL:" >&2
    # shellcheck disable=SC2086
    ps -o pid,ppid,pgid,etime,args -p $left 2>/dev/null >&2 || true
    echo "  They may hold descriptors inherited from this run (e.g. a flock held by the caller)." >&2
  fi
  return 0
}

sdui_on_signal() {
  local sig="$1"
  sdui_stop_detached "${DUMP_PID_FILE:-}"
  trap - "$sig" EXIT
  kill -"$sig" "$$"
}

# Sourced rather than executed: publish the lifecycle helpers above and do
# nothing else, so the cleanup contract can be exercised without a console
# build. `${BASH_SOURCE[0]}` differs from `$0` exactly when this file is sourced.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

FRAMEWORK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHA_FILE="${FRAMEWORK_ROOT}/.objectui-sha"

if [[ ! -f "$SHA_FILE" ]]; then
  echo "✗ ${SHA_FILE} is missing — cannot determine which objectui commit to use."
  exit 1
fi
PINNED_SHA="$(tr -d '[:space:]' < "$SHA_FILE")"

BUILD_ROOT="${FRAMEWORK_ROOT}/.cache/objectui-${PINNED_SHA:0:12}"
TARGET="${FRAMEWORK_ROOT}/packages/console/dist"
DUMP_PAGE="${BUILD_ROOT}/apps/console/dev/manifest-dump.html"
DUMP_SCRIPT="${BUILD_ROOT}/scripts/dump-public-manifest.mjs"

if [[ ! -d "$BUILD_ROOT" ]]; then
  echo "✗ objectui build tree not found at ${BUILD_ROOT}"
  echo "  Run 'pnpm objectui:build' first to vendor the console at the pinned SHA."
  exit 1
fi
if [[ ! -f "$DUMP_PAGE" || ! -f "$DUMP_SCRIPT" ]]; then
  echo "ℹ manifest dump tooling not present at objectui@${PINNED_SHA:0:12} — nothing to do."
  echo "  (bump .objectui-sha to >=96b1293 to enable full JSX validation)"
  exit 0
fi

echo "→ Generating SDUI public-tier manifest (ADR-0080) from objectui@${PINNED_SHA:0:12}..."
pushd "$BUILD_ROOT" > /dev/null

DUMP_PORT=5180
DUMP_DEV_LOG="/tmp/sdui-dump-dev.log"
DUMP_PID_FILE="$(mktemp "${TMPDIR:-/tmp}/sdui-dump-pid.XXXXXX")"

# Armed BEFORE the spawn: everything from here on must be able to fail without
# leaving a server behind. EXIT alone is not enough — bash runs no EXIT trap
# when the script is itself signalled, and being signalled is exactly how an
# agent container reclaims a run.
trap 'sdui_stop_detached "${DUMP_PID_FILE:-}"' EXIT
trap 'sdui_on_signal INT' INT
trap 'sdui_on_signal TERM' TERM
trap 'sdui_on_signal HUP' HUP

sdui_spawn_detached "$DUMP_PID_FILE" "$DUMP_DEV_LOG" \
  pnpm --filter @object-ui/console exec vite dev --port "$DUMP_PORT"

# `curl`, not a socket table: `ss`/`netstat` are absent from the agent dispatch
# containers, and `ss -ltn | grep :$DUMP_PORT` prints nothing there whether or
# not anything is listening (docs/qa/platform-checklist/RUNNER.md).
for _ in $(seq 1 90); do curl -sf "http://localhost:${DUMP_PORT}/" > /dev/null 2>&1 && break; sleep 1; done

if BASE_URL="http://localhost:${DUMP_PORT}" OUT="${TARGET}/sdui.manifest.json" node scripts/dump-public-manifest.mjs; then
  echo "✓ wrote ${TARGET}/sdui.manifest.json"
else
  status=$?
  echo "✗ manifest generation failed (exit ${status})."
  echo "  If Playwright reported a missing browser, install it and retry:"
  echo "    pnpm exec playwright install chromium-headless-shell"
  echo "  Can't install here (e.g. an agent dispatch container)? See docs/releases-maintenance.md"
  echo "  'If the dispatch container's Playwright browser doesn't match the revision'."
  popd > /dev/null
  exit "$status"
fi
popd > /dev/null

# ADR-0081/0082: ratchet the spec↔registry react-block DECLARATION PARITY against
# the committed baseline.
#
# `--strict`, i.e. this now GATES. It used to run without it and swallow the exit
# code behind a `⚠`, so "divergence recorded" and "divergence stopped" were two
# very different things wearing the same green build (#4472, secondary finding 1).
# The ratchet only fires on divergence NEW since the accepted baseline, so a
# failure here is a deliberate registry change that needs either a spec/overlay
# edit or an explicit `--update` to accept — never pre-existing noise.
#
# Scope, since a green line here is easy to over-read: this compares two
# DECLARATIONS (spec zod props vs registry-declared inputs) and inspects no
# renderer. See the header of check-react-blocks-declaration-parity.ts.
if [[ -f "${FRAMEWORK_ROOT}/packages/spec/react-declaration-parity.baseline.json" ]]; then
  echo "→ Ratcheting spec↔registry react-block declaration parity (ADR-0082)..."
  ( cd "${FRAMEWORK_ROOT}" && MANIFEST="${TARGET}/sdui.manifest.json" \
    pnpm --filter @objectstack/spec check:react-declaration-parity \
    --baseline react-declaration-parity.baseline.json --strict )
fi
