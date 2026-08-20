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

# ---------------------------------------------------------------------------
# Collision safety between CONCURRENT RUNS.
#
# Agent dispatch containers run several agents against one filesystem and one
# network namespace, so a fixed port and a fixed log path are shared mutable
# state. Measured on the pinned vite (8.2.1, objectui's lockfile at the SHA in
# .objectui-sha) with another server already holding the requested port:
#
#     $ vite dev --port 5390
#     Port 5390 is in use, trying another one...
#       ➜  Local:   http://localhost:5391/
#
# So run B's server comes up on 5391 while run B's probe and BASE_URL still name
# 5390: run B curls run A's server, succeeds, and dumps A's manifest as its own
# with exit 0 and no diagnostic. That output feeds the ADR-0082 declaration
# parity ratchet below, which is why a wrong-but-plausible manifest is worse
# here than no manifest at all.
#
# `--strictPort` is necessary but NOT sufficient, and that was measured too. With
# it, run B's vite exits — `Error: Port 5390 is already in use` — into run B's OWN
# log, while run A keeps answering on 5390. A probe that asks only "does the port
# answer?" still gets 200, and still dumps A's tree. Both halves are required:
#
#   1. `--strictPort`, so the port we ASKED for is the port we GOT, or no server
#      of ours exists at all. Without it `--port` is a request vite may silently
#      decline, and "where I asked the server to be" stops meaning "where it is".
#   2. a probe that requires the session THIS RUN spawned to still be alive
#      before it accepts an answer on that port. Given (1), "our leader is alive"
#      leaves no third possibility: what answers on $DUMP_PORT is ours.
#
# That pair is what makes $DUMP_PORT single-valued in the sense that matters.
# Deriving the probe URL and BASE_URL from one variable was ALREADY true when
# this defect was filed and did not prevent it — the divergence was never between
# two literals in this file, it was between the port requested and the port bound.
# ---------------------------------------------------------------------------

# Print a TCP port on 127.0.0.1 that is free right now, searching upward from $1.
#
# ADVISORY ONLY. It reserves nothing, and between this probe and vite's own bind
# a concurrent run can take the port. Closing that race is not this helper's job:
# `--strictPort` turns losing it into a loud failure instead of a silent redirect
# onto a neighbour's server.
#
# 127.0.0.1 is the interface vite's dev server binds. A wildcard listener on the
# same port collides with a loopback bind too, so this probe sees a neighbour
# whichever way the neighbour bound.
sdui_pick_free_port() {
  local base="${1:-5180}" span="${2:-200}"
  node - "$base" "$span" << 'SDUI_PICK_FREE_PORT'
const net = require('node:net');
const base = Number(process.argv[2]);
const span = Number(process.argv[3]);
const isFree = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
(async () => {
  for (let port = base; port < base + span; port += 1) {
    if (await isFree(port)) {
      process.stdout.write(String(port));
      return;
    }
  }
  process.stderr.write(`no free TCP port in [${base}, ${base + span})\n`);
  process.exitCode = 1;
})();
SDUI_PICK_FREE_PORT
}

# The dev-server argv for port $1, one word per line.
#
# A function rather than an inline command line so the `--strictPort` half of the
# fix is assertable by SOURCING this file, instead of only by grepping it. A grep
# assertion would also pass against a version that merely mentions the flag in a
# comment, which is the failure mode the cleanup test's header warns about.
sdui_dev_server_cmd() {
  local port="$1"
  printf '%s\n' pnpm --filter @object-ui/console exec vite dev --port "$port" --strictPort
}

# Wait until the dev server THIS RUN spawned answers on port $2, or fail.
#   $1 pidfile written by sdui_spawn_detached   $2 port   $3 timeout seconds
#
# The liveness check is ordered BEFORE the curl deliberately: a neighbouring run's
# server on the same port answers 200 exactly like ours, so "the port answers" is
# no evidence by itself. Reading our own leader first — and again after a
# successful curl, since ours can exit between the two — is what makes a green
# here mean "our server". It also turns a collision into a fast, explicit failure
# instead of a 90-second wait ending in a confident wrong answer.
#
# `curl`, not a socket table: `ss`/`netstat` are absent from the agent dispatch
# containers, and `ss -ltn | grep :$PORT` prints nothing there whether or not
# anything is listening (docs/qa/platform-checklist/RUNNER.md).
sdui_wait_for_own_server() {
  local pidfile="${1:-}" port="${2:-}" timeout="${3:-90}" leader="" _i
  for _i in $(seq 1 "$timeout"); do
    leader="$(tr -d '[:space:]' < "$pidfile" 2>/dev/null || true)"
    case "$leader" in '' | *[!0-9]*) leader="" ;; esac
    if [[ -n "$leader" && -z "$(sdui_live_pids "$leader")" ]]; then
      echo "✗ the dev server this run started is no longer running." >&2
      return 1
    fi
    if curl -sf "http://localhost:${port}/" > /dev/null 2>&1; then
      if [[ -n "$leader" && -z "$(sdui_live_pids "$leader")" ]]; then
        echo "✗ the dev server this run started exited while its port was being probed." >&2
        return 1
      fi
      return 0
    fi
    sleep 1
  done
  echo "✗ the dev server this run started never answered on port ${port} within ${timeout}s." >&2
  return 1
}

sdui_on_signal() {
  local sig="$1"
  sdui_stop_detached "${DUMP_PID_FILE:-}"
  trap - "$sig" EXIT
  kill -"$sig" "$$"
}

# ---------------------------------------------------------------------------
# The remedy for a failed dump is CHOSEN from what failed, not fixed in advance.
#
# WHY. Every failure of the dump below used to print one remedy — `playwright
# install chromium-headless-shell` — because a missing browser was the failure
# the author had in hand. Measured with `packages/console/dist/` absent: the
# dump itself SUCCEEDED (the browser launched, the registry was enumerated) and
# only the final `writeFileSync` failed —
#
#     Error: ENOENT: no such file or directory, open '.../sdui.manifest.json'
#
# — and the run still printed the Playwright remedy. A reader who follows it
# reinstalls a browser that was never the problem; in an agent dispatch
# container they cannot even do that, because `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
# is set there and agents are instructed not to override it (see
# docs/releases-maintenance.md, "If the dispatch container's Playwright browser
# doesn't match the revision"). Advice that names the wrong layer with
# confidence costs MORE than no advice, because it is followed — that round was
# spent on the Playwright trail while the defect was one absent directory.
#
# So: the Playwright remedy is printed only on Playwright EVIDENCE, and the
# fallback is "unclassified", never "Playwright". The direction of that default
# is the whole fix; a classifier that guesses Playwright when it recognises
# nothing is the same defect wearing a conditional.
#
# The signatures are the ones this repo has actually measured, not invented:
# `browserType.launch: Executable doesn't exist at ...` is verbatim what the
# container's revision mismatch produced (docs/releases-maintenance.md), and the
# install banner is what playwright prints beside it.
#
# Reads the log as a FILE rather than piping text into grep: `grep -q` exits on
# the first match, and under `set -o pipefail` the SIGPIPE'd producer upstream
# would then set the pipeline non-zero — turning a match into a miss for exactly
# the long outputs that need classifying most.
#
#   $1  file holding the dump's combined output
#   $2  the OUT path the dump was given
sdui_dump_failure_advice() {
  local log="${1:-}" out="${2:-}"

  if [[ -n "$log" && -r "$log" ]] &&
    grep -qaE "browserType\.launch|Executable doesn't exist|playwright install|download new browsers" -- "$log"; then
    echo "  Playwright could not start a browser — that IS this failure. Install the"
    echo "  matching one and retry:"
    echo "    pnpm exec playwright install chromium-headless-shell"
    echo "  Can't install here (e.g. an agent dispatch container)? See docs/releases-maintenance.md"
    echo "  'If the dispatch container's Playwright browser doesn't match the revision'."
    return 0
  fi

  # A write failure names the path it could not open, so requiring BOTH the
  # errno and this run's own OUT path keeps an unrelated ENOENT elsewhere in the
  # output from being read as one.
  if [[ -n "$log" && -r "$log" && -n "$out" ]] &&
    grep -qaE '(ENOENT|EACCES|EROFS|ENOSPC|EISDIR|EPERM)' -- "$log" &&
    grep -qaF -- "$out" "$log"; then
    echo "  The dump could not WRITE its output. The browser side is not implicated"
    echo "  and 'playwright install' would change nothing here."
    echo "    output file:      ${out}"
    echo "    its directory:    $(dirname -- "$out")"
    echo "  Check that directory exists and is writable, then re-run."
    return 0
  fi

  echo "  This failure was NOT identified as a missing Playwright browser, so"
  echo "  'pnpm exec playwright install ...' is not the indicated remedy for it."
  echo "  Read the dump's own output above first."
  if [[ -n "$log" ]]; then echo "  It is saved at ${log}"; fi
  return 0
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

# The output directory, created HERE — with the other preconditions, before the
# dev server and the browser, rather than implicitly at write time.
#
# `packages/console/dist/` is gitignored and exists only after a successful
# `scripts/build-console.sh`, so on a tree whose console build is broken it is
# simply ABSENT. Nothing created it and objectui's dumper calls `writeFileSync`
# straight out, so the run died `ENOENT ... sdui.manifest.json` — after it had
# already paid for a vite dev server and a chromium launch. That cost is why
# this is a precondition and not a `mkdir` beside the write: a precondition that
# can only fail cheaply is one nobody has to debug at the end of a long run.
#
# It also removes a false coupling. The ratchet does not need the built dist at
# all — this script drives a vite DEV server over `.cache/objectui-<sha>`, and
# `dist/` is only where the manifest LANDS — so refusing to run for want of a
# directory left the ADR-0082 D4 ratchet unrunnable exactly on the trees that
# most want an independent read on the registry.
if ! mkdir -p "$TARGET"; then
  echo "✗ could not create the manifest output directory: ${TARGET}"
  exit 1
fi

echo "→ Generating SDUI public-tier manifest (ADR-0080) from objectui@${PINNED_SHA:0:12}..."
pushd "$BUILD_ROOT" > /dev/null

# Per-run port. `SDUI_DUMP_PORT` pins one explicitly and is honoured exactly —
# no search — because an explicit request that quietly lands somewhere else is
# the defect this block exists to remove; `--strictPort` makes a busy pinned port
# fail loudly, which is what an explicit request should do. Unset, the search
# starts at 5180 so an uncontended run still lands where the docs say it does.
if [[ -n "${SDUI_DUMP_PORT:-}" ]]; then
  DUMP_PORT="$SDUI_DUMP_PORT"
else
  DUMP_PORT="$(sdui_pick_free_port 5180 || true)"
fi
# Never let an empty or non-numeric value through: the dump consumer defaults to
# `http://localhost:5180` when BASE_URL is absent, and that default is precisely
# the shared port this run is trying not to use.
case "$DUMP_PORT" in
  '' | *[!0-9]*)
    echo "✗ could not find a free TCP port for this run's dev server." >&2
    exit 1
    ;;
esac

# Per-run log. The fixed path this replaced was truncated by whichever run
# started last, so a diagnosing reader could be reading another run's output —
# and the failure branches below point readers straight at it. mktemp, matching
# the pidfile beside it.
DUMP_DEV_LOG="$(mktemp "${TMPDIR:-/tmp}/sdui-dump-dev.XXXXXX.log")"
DUMP_PID_FILE="$(mktemp "${TMPDIR:-/tmp}/sdui-dump-pid.XXXXXX")"

echo "  dev server: port ${DUMP_PORT}, log ${DUMP_DEV_LOG}"

# Armed BEFORE the spawn: everything from here on must be able to fail without
# leaving a server behind. EXIT alone is not enough — bash runs no EXIT trap
# when the script is itself signalled, and being signalled is exactly how an
# agent container reclaims a run.
trap 'sdui_stop_detached "${DUMP_PID_FILE:-}"' EXIT
trap 'sdui_on_signal INT' INT
trap 'sdui_on_signal TERM' TERM
trap 'sdui_on_signal HUP' HUP

readarray -t DUMP_DEV_ARGV < <(sdui_dev_server_cmd "$DUMP_PORT")
sdui_spawn_detached "$DUMP_PID_FILE" "$DUMP_DEV_LOG" "${DUMP_DEV_ARGV[@]}"

# Failing here is a REFUSAL TO GUESS, not an inconvenience: the alternative is
# dumping whatever else happens to answer on this port. See the collision-safety
# block above for what the two halves buy.
if ! sdui_wait_for_own_server "$DUMP_PID_FILE" "$DUMP_PORT" 90; then
  echo "  Its log for this run is at ${DUMP_DEV_LOG}"
  echo "  A port taken by a concurrent run reports 'Port ${DUMP_PORT} is already in use' there;"
  echo "  re-run, or pin a port with SDUI_DUMP_PORT=<free port>."
  popd > /dev/null
  exit 1
fi

# The dump's combined output goes to a per-run file as well as to the terminal:
# the failure branch classifies that text, and a remedy chosen from what
# actually happened is the point (see sdui_dump_failure_advice above).
DUMP_OUT_LOG="$(mktemp "${TMPDIR:-/tmp}/sdui-dump-out.XXXXXX.log")"

# `${PIPESTATUS[0]}`, never `$?`: after a pipeline `$?` is TEE's status, and tee
# does not fail, so `$?` here would read every failure of the dump as a success.
set +e
BASE_URL="http://localhost:${DUMP_PORT}" OUT="${TARGET}/sdui.manifest.json" \
  node scripts/dump-public-manifest.mjs 2>&1 | tee "$DUMP_OUT_LOG"
dump_status="${PIPESTATUS[0]}"
set -e

if [[ "$dump_status" -eq 0 ]]; then
  echo "✓ wrote ${TARGET}/sdui.manifest.json"
  rm -f "$DUMP_OUT_LOG"
else
  echo "✗ manifest generation failed (exit ${dump_status})."
  sdui_dump_failure_advice "$DUMP_OUT_LOG" "${TARGET}/sdui.manifest.json"
  echo "  The dev server log for THIS run is at ${DUMP_DEV_LOG}"
  popd > /dev/null
  exit "$dump_status"
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
