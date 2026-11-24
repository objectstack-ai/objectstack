#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# fetch-history -- the body of ci.yml's "Fetch this commit's history and the
# base branch" step, shared by its five jobs (`test-plan`, `test`,
# `type-check-ui`, `test-ui-plan`, `test-ui`). They used to carry five inline
# copies, verbatim but for the budget (#22034); the attempt bound below is why
# they became one (#34561).
#
#   bash scripts/ci/fetch-history.sh            # in the step, PR_BASE_REF from its `env:`
#   bash scripts/ci/fetch-history.selftest.sh   # offline: a stub `git fetch` per case
#
# What it fetches, and why (the `test` job's comment in ci.yml has the
# measurements): HEAD's whole ancestry and refs/remotes/origin/main, plus the
# pull request's base branch when that is not main. No tags, no other heads.
#
# ⭐ EACH ATTEMPT IS BOUNDED BY SILENCE, SO THE RETRY CAN HAPPEN (#34561).
# The three-attempt loop retried a fetch that FAILED, never one that STALLED.
# Four step timeouts in five hours on 2026-11-16/17 (push 6a7403ba Test Core
# 7/8, merge groups pr-34447 Test Core 5/8, pr-34381 Test UI 4/16, pr-34511
# Plan Test Core shards) read the same way in the three logs found: attempt 1
# printed nothing until the step budget (8, 14 or 20 minutes) killed it, the
# runner then terminated an orphan `git` and `git-remote-https`, and attempt 2
# never started. Their sibling shards in the same runs fetched the same
# history in 47-96 s, so neither depth nor size was the cause: a transfer
# stalled and nothing noticed.
#
# So the fetch runs with `--progress` into a log, in its own session, and an
# attempt that writes nothing for STALL_SECONDS (60) is killed with its whole
# process group (the `git-remote-https` helper included) and retried.
#
# ⭐ ...AND BY ITS BYTE RATE, BECAUSE A HUNG FETCH CAN KEEP PRINTING (#34994).
# Silence was the wrong signal. A healthy fetch prints at least every second,
# but the converse does not hold. The next 13 step timeouts (2026-11-17, 8-20
# minutes each) all died in attempt 1 with no `::warning::` and no attempt 2:
# the watchdog loop ran for the whole budget (its `sleep` was among the
# orphans) and never saw 60 s of silence. Each one's orphans were `git`, `git`
# and `git-remote-https`, never `index-pack`, which fetch-pack starts only
# once it reads the pack header. So the server never started the pack, and
# meanwhile its enumerate/count/compress progress (`remote: ...`, carried on
# the sideband) kept the log growing. lint.yml's checkouts and ci.yml's
# depth-1 checkouts stalled the same way, and same-run siblings took 51-65 s.
#
# So every attempt also runs under curl's low-speed abort: a request that
# moves under GIT_HTTP_LOW_SPEED_LIMIT (1000) bytes/s for GIT_HTTP_LOW_SPEED_TIME
# (120) seconds exits 128 ("curl 28 Operation too slow"), the loop below
# retries it, and server progress is far too few bytes to hold it open. Both
# workflows set the same two values for every job, so actions/checkout's own
# retry gets the same bound; this script exports them only when they are
# unset, so a local run is bounded too. Measured on this fetch: the server
# starts the pack after ~15 s and a healthy receive runs at MiB/s, so neither
# number cuts a slow transfer that moves. The silence bound stays as the
# backstop for a request that sends nothing at all.
#
# Each phase is printed as it starts, with the attempt's elapsed seconds, so a
# step that still hits its wall names where it stood. The attempt's own log is
# printed only when it ends, and the step timeout kills this script first.
# The step's `timeout-minutes` stays the outer wall, unchanged.
#
# Inputs: PR_BASE_REF (empty on push and merge_group); GIT_HTTP_LOW_SPEED_LIMIT
# and GIT_HTTP_LOW_SPEED_TIME (the workflows' values; defaults below). Test
# knobs, for the self-test only: FETCH_HISTORY_STALL_SECONDS and
# FETCH_HISTORY_RETRY_SLEEP.
set -uo pipefail

export GIT_HTTP_LOW_SPEED_LIMIT="${GIT_HTTP_LOW_SPEED_LIMIT:-1000}"
export GIT_HTTP_LOW_SPEED_TIME="${GIT_HTTP_LOW_SPEED_TIME:-120}"

STALL_SECONDS="${FETCH_HISTORY_STALL_SECONDS:-60}"
RETRY_SLEEP="${FETCH_HISTORY_RETRY_SLEEP:-15}"
ATTEMPTS=3

refspecs=('+refs/heads/main:refs/remotes/origin/main')
if [ -n "${PR_BASE_REF:-}" ] && [ "$PR_BASE_REF" != main ]; then
  refspecs+=("+refs/heads/$PR_BASE_REF:refs/remotes/origin/$PR_BASE_REF")
fi
head=$(git rev-parse HEAD) || exit 1
log="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/fetch-history.XXXXXX")" || exit 1
trap 'rm -f "$log"' EXIT

# The attempt's own output with progress carriage returns turned into lines,
# and each progress phase ("Receiving objects", "Resolving deltas", ...) cut to
# its last line: enough to name the phase a stalled attempt stopped in.
show_log() {
  tr '\r' '\n' < "$log" | awk '
    NF { key = $0; sub(/:.*/, "", key)
         if (held != "" && key != heldkey) print held
         held = $0; heldkey = key }
    END { if (held != "") print held }'
}

# The phase the attempt is in now: its last COMPLETE line (a trailing write
# with no carriage return or newline yet is not read as a phase), cut to the
# phase name ("remote: Counting objects", "Receiving objects", ...).
current_phase() {
  local partial=0
  case "$(tail -c 1 "$log" | od -An -c | tr -d ' ')" in
    '\n' | '\r' | '') ;;
    *) partial=1 ;;
  esac
  tr '\r' '\n' < "$log" | awk -v partial="$partial" '
    NF { line = $0; pre = ""
         if (sub(/^remote: /, "", line)) pre = "remote: "
         sub(/:.*/, "", line); prev = key; key = pre line }
    END { print (partial ? prev : key) }'
}

# One fetch attempt. Returns git's exit status, or 124 when it was killed for
# STALL_SECONDS of silence. `setsid` gives git a process group of its own (a
# background job of a non-interactive shell is never a group leader, so setsid
# does not fork and $! is git itself), and the kill reaches every process in it.
fetch_once() {
  : > "$log"
  setsid git "$@" < /dev/null > "$log" 2>&1 &
  local pid=$! size last=-1 quiet=0 rc phase='' now start=$SECONDS
  while kill -0 "$pid" 2> /dev/null; do
    sleep 1
    size=$(wc -c < "$log")
    if [ "$size" -ne "$last" ]; then
      last=$size
      quiet=0
      now=$(current_phase)
      if [ -n "$now" ] && [ "$now" != "$phase" ]; then
        phase=$now
        echo "fetch-history: +$((SECONDS - start))s ${phase}"
      fi
    else
      quiet=$((quiet + 1))
    fi
    if [ "$quiet" -ge "$STALL_SECONDS" ]; then
      kill -TERM -- "-$pid" 2> /dev/null
      sleep 2
      kill -KILL -- "-$pid" 2> /dev/null
      wait "$pid" 2> /dev/null
      show_log
      echo "::warning::git fetch wrote nothing for ${STALL_SECONDS}s after ${size} byte(s) of output, so it was killed with its process group (#34561)."
      return 124
    fi
  done
  wait "$pid"
  rc=$?
  show_log
  return "$rc"
}

echo "Each attempt ends when it moves under $GIT_HTTP_LOW_SPEED_LIMIT bytes/s for ${GIT_HTTP_LOW_SPEED_TIME}s (curl) or writes nothing for ${STALL_SECONDS}s, and is retried."
attempt=1
while :; do
  deepen=()
  if [ "$(git rev-parse --is-shallow-repository)" = true ]; then deepen=(--unshallow); fi
  echo "Attempt $attempt of $ATTEMPTS: git fetch --progress --no-tags ${deepen[*]:-} origin $head ${refspecs[*]}"
  if fetch_once fetch --progress --no-tags ${deepen[@]+"${deepen[@]}"} origin "$head" "${refspecs[@]}"; then
    break
  fi
  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "::error::Could not fetch $head's history and ${refspecs[*]} after $ATTEMPTS attempts. This job's history readers need it, so this job stops here rather than reading from a shallow clone."
    exit 1
  fi
  sleep $((attempt * RETRY_SLEEP))
  attempt=$((attempt + 1))
done
echo "History: $(git rev-list --count HEAD) commit(s) behind HEAD, shallow=$(git rev-parse --is-shallow-repository), no tags, refs: $(git for-each-ref --format='%(refname)' refs/remotes | tr '\n' ' ')"
