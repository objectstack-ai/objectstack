#!/usr/bin/env bash
#
# Make the Playwright jobs independent of Ubuntu's apt mirrors (objectui#5304).
#
# ── What went wrong ───────────────────────────────────────────────────────────
# `playwright install --with-deps` / `playwright install-deps` shell out to
# `apt-get update` as root. On 2026-08-19 that hung `Build & E2E` three times,
# each for the full 30-minute job ceiling, with a byte-identical last line:
#
#   Get:5 https://archive.ubuntu.com/ubuntu noble-security InRelease [126 kB]
#
#   PR #5290 job 95986117935  07:05:48 -> cancelled 07:34:39 (30m14s)
#   PR #5290 job 95993643751  07:38:31 -> cancelled 08:07:32 (30m18s)  (re-run)
#   PR #5294 job 95988703670  07:17:27 -> cancelled 07:46:21 (30m17s)
#
# In each run the runner's `azure.archive.ubuntu.com` mirror answered `Ign:` for
# all four noble indexes, apt fell back to `archive.ubuntu.com`, started three
# InRelease fetches and never returned. apt applies no timeout that covers a
# mirror which accepts the connection and then trickles, so the only backstop
# was the job's `timeout-minutes` — which turns a transient mirror fault into a
# cancelled gate that reports nothing.
#
# It is a transient rather than a property of the workflow: on #5290 the
# `Live E2E (informational)` job (95986118258) ran the SAME `install-deps` step
# on the SAME commit in the SAME minute and finished green in 3m26s. That is
# precisely why the call has to be bounded rather than trusted.
#
# ── Why the happy path needs no apt at all ────────────────────────────────────
# The browser binaries come from the `actions/cache` step, not from apt
# (measured on the very run that then hung: `Cache hit for:
# playwright-Linux-1.62.1`, 269 MB restored). The system libraries come from the
# runner image, which ships Google Chrome, Microsoft Edge and Firefox — their
# shared-library closure is the one `install-deps chromium` asks for.
#
# So: probe first, and only reach for apt if the probe says a library really is
# missing. The probe is the honest test — it launches the same bundled Chromium
# the suite launches, in the same environment, on every run. Nothing here is
# assumed about the image; if the assumption above ever stops holding, the
# recovery path below runs and says so in the log.
#
# ── Why this does not make the gate quieter ───────────────────────────────────
# Every exit is a verdict. If Chromium cannot launch and apt cannot fix it, this
# script exits non-zero and the job goes RED — it is never skipped, never
# `continue-on-error`, and the E2E suite still has to pass afterwards. What
# changes is only that a stalled mirror costs seconds instead of consuming the
# whole job ceiling and cancelling the check.
set -uo pipefail

# Bounds the apt recovery path. Deliberately far below any job `timeout-minutes`
# so this script can never be the thing that consumes the ceiling.
DEPS_TIMEOUT=${OS_CHROMIUM_DEPS_TIMEOUT:-240}

# Test seams. `scripts/__tests__/ensure-chromium-ready.test.ts` substitutes both
# so the four branches below can be exercised without a browser or a network —
# in particular the one that matters, "a hanging apt cannot hang the job".
DEPS_CMD=${OS_CHROMIUM_DEPS_CMD:-"pnpm exec playwright install-deps chromium"}
PROBE_CMD=${OS_CHROMIUM_PROBE_CMD:-}

# ── Bounding the recovery call on a host that has no GNU coreutils ────────────
# `timeout` is GNU coreutils, and a stock macOS host has neither it nor
# Homebrew's `gtimeout` (objectui#8404). Written as a bare `timeout`, the bound
# did not merely go missing there: the call itself failed at 127 before
# `install-deps` ever ran, so the recovery path could not recover and reported
# only "install-deps failed with exit 127". A contributor running this script on
# their own machine is exactly the reader this repo floors its shell for.
#
# Three resolutions, in order, and ⛔ there is no fourth branch that runs the
# command unbounded — an unbounded dependency install IS objectui#5304.
#
# ⚠️ The floor is bash 3.2 (scripts/check-bash32-floor.mjs), so the fallback
# uses no `wait -n`, no `$EPOCHSECONDS` and no bash-4 operator. It polls with
# `kill -0` and reports the deadline through a marker file, because `wait`
# cannot tell a watchdog's TERM from any other TERM.
run_bounded() {
  bounded_secs=$1
  bounded_cmd=$2

  if command -v timeout > /dev/null 2>&1; then
    timeout -k 15s "${bounded_secs}s" bash -c "$bounded_cmd"
    return $?
  fi
  if command -v gtimeout > /dev/null 2>&1; then
    gtimeout -k 15s "${bounded_secs}s" bash -c "$bounded_cmd"
    return $?
  fi

  echo "Neither 'timeout' nor 'gtimeout' is on this host; bounding the call from bash itself."
  bounded_fired="${TMPDIR:-/tmp}/os-chromium-deps-deadline.$$"
  rm -f "$bounded_fired"

  bash -c "$bounded_cmd" &
  bounded_pid=$!

  # Redirected to /dev/null on purpose: a background child holding the inherited
  # stdout keeps the pipe open, and a caller that reads this script's output to
  # completion (the test does) would wait for the watchdog rather than the work.
  (
    bounded_left=$bounded_secs
    while [ "$bounded_left" -gt 0 ]; do
      kill -0 "$bounded_pid" 2> /dev/null || exit 0
      sleep 1
      bounded_left=$((bounded_left - 1))
    done
    : > "$bounded_fired"
    kill -TERM "$bounded_pid" 2> /dev/null
    sleep 15
    kill -KILL "$bounded_pid" 2> /dev/null
  ) > /dev/null 2>&1 &
  bounded_watchdog=$!

  wait "$bounded_pid"
  bounded_status=$?
  kill -TERM "$bounded_watchdog" 2> /dev/null
  wait "$bounded_watchdog" 2> /dev/null

  if [ -f "$bounded_fired" ]; then
    rm -f "$bounded_fired"
    # 124 is `timeout`'s own "deadline expired", so the caller below reads one
    # verdict whichever of the three branches produced it.
    return 124
  fi
  rm -f "$bounded_fired"
  return $bounded_status
}

# Launches the bundled Chromium exactly as `playwright.config.ts` does — its
# `chromium` project is `devices['Desktop Chrome']` with no `channel`, so the
# default launch is the representative one.
probe() {
  if [ -n "$PROBE_CMD" ]; then
    bash -c "$PROBE_CMD"
    return $?
  fi
  node --input-type=module -e '
    import { chromium } from "@playwright/test";
    const browser = await chromium.launch();
    await browser.close();
  '
}

if probe; then
  echo "Chromium launches with the libraries already present on this image."
  echo "No apt-get on this path (objectui#5304)."
  exit 0
fi

echo "---"
echo "Chromium did not launch, so a system library is genuinely missing."
echo "Falling back to 'playwright install-deps', bounded at ${DEPS_TIMEOUT}s so a"
echo "stalled Ubuntu mirror cannot hang this job the way it did in objectui#5304."

# `-k` escalates to KILL if apt ignores the TERM: a process blocked in a socket
# read is exactly the shape that does. 124 is timeout's own "deadline expired",
# and `run_bounded` reports the same 124 from whichever branch bounded the call.
run_bounded "$DEPS_TIMEOUT" "$DEPS_CMD"
deps_status=$?

if [ "$deps_status" -eq 124 ] || [ "$deps_status" -eq 137 ]; then
  echo "install-deps exceeded ${DEPS_TIMEOUT}s and was killed (exit ${deps_status})." >&2
  echo "This is the objectui#5304 signature: an apt mirror that accepts the" >&2
  echo "connection and then never completes the transfer." >&2
elif [ "$deps_status" -ne 0 ]; then
  echo "install-deps failed with exit ${deps_status}." >&2
else
  echo "install-deps completed."
fi

# Whatever apt did or did not manage, the question is unchanged and is settled
# the same way: can Chromium launch? Only the probe may answer it.
if probe; then
  echo "Chromium launches after installing its system libraries."
  exit 0
fi

echo "---" >&2
echo "Chromium still cannot launch after the recovery attempt above." >&2
echo "Failing the job: the E2E suite cannot produce a verdict without a browser," >&2
echo "and a gate that cannot produce a verdict must not report green." >&2
exit 1
