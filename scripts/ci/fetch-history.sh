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
# process group (the `git-remote-https` helper included) and retried. A fetch
# that keeps moving is never cut, however slow: a healthy one prints a line at
# least every second (enumerating, counting, compressing, then receiving with
# its byte rate), so 60 s of silence is a hang, not a slow network. The step's
# `timeout-minutes` stays the outer wall, unchanged.
#
# Inputs: PR_BASE_REF (empty on push and merge_group). Test knobs, for the
# self-test only: FETCH_HISTORY_STALL_SECONDS and FETCH_HISTORY_RETRY_SLEEP.
set -uo pipefail

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

# One fetch attempt. Returns git's exit status, or 124 when it was killed for
# STALL_SECONDS of silence. `setsid` gives git a process group of its own (a
# background job of a non-interactive shell is never a group leader, so setsid
# does not fork and $! is git itself), and the kill reaches every process in it.
fetch_once() {
  : > "$log"
  setsid git "$@" < /dev/null > "$log" 2>&1 &
  local pid=$! size last=-1 quiet=0 rc
  while kill -0 "$pid" 2> /dev/null; do
    sleep 1
    size=$(wc -c < "$log")
    if [ "$size" -ne "$last" ]; then
      last=$size
      quiet=0
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
