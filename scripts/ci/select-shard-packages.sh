#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# select-shard-packages -- the Test Core package set, decided from the event.
#
#   OS_SHARD_EVENT_NAME=pull_request OS_SHARD_PR_BASE_REF=main \
#   OS_SHARD_PR_PINNED_BASE_SHA=<sha> RUNNER_TEMP=/tmp/rt \
#     bash scripts/ci/select-shard-packages.sh
#   OS_SHARD_EVENT_NAME=merge_group OS_SHARD_MERGE_GROUP_BASE_SHA=<sha> \
#   RUNNER_TEMP=/tmp/rt bash scripts/ci/select-shard-packages.sh
#   bash scripts/ci/select-shard-packages.selftest.sh   # every branch, offline
#
# Environment in, `$RUNNER_TEMP/turbo-ls.json` out (a `turbo ls --output=json`
# payload, ready for partition-test-shards.mjs), `::warning::` lines out for
# every fallback. Exit 0 on every decided outcome -- a fallback to the full
# list is a decision, not a failure; exit 2 on a usage error; and a failing
# `turbo ls` exits with turbo's own status, exactly as it did under `bash -e`
# when this text lived inline in ci.yml (see below).
#
# ## What decides the set, per event (#16453)
#
#   pull_request  affected set against merge-base(origin/<base ref>, HEAD),
#                 unioned with the cross-package scans the diff touches.
#   merge_group   affected set against the group's own base --
#                 `github.event.merge_group.base_sha` -- with the same union.
#                 The queue builds each entry as merged onto the current main
#                 (or onto the entry ahead of it) and NAMES that base, so there
#                 is no merge-base to compute and no frozen sha to drift from.
#   push          the FULL list, unchanged: a push to main gates nobody, and
#                 it is the ground truth the shard-timings refresh reads.
#
# An EMPTY affected set on merge_group is legitimate -- a docs-only group has
# nothing to test -- and flows into ci.yml's existing "No packages on this
# shard -- nothing to test" path, where every shard still attests and the
# `Test Core` gate counts six credentials over zero packages: an honest green.
# It is NOT the #10057 case; that guard is pull_request-only, and the comment
# beside it below says why the two cannot be told apart anywhere else.
#
# ## Why this is a script and not the step's `run:` block
#
# The selection used to be ~120 lines of inline shell with `${{ }}` expressions
# in it, which cannot be run anywhere but on a runner -- so a `merge_group`
# branch, which by construction cannot run until the PR is already in the
# queue, could not be proved before it landed. Reading plain environment
# variables instead lets the selftest drive every branch offline with a fake
# `turbo` on PATH, and lets a reviewer run the four event shapes locally.
# The pull_request branch was moved here VERBATIM: its comments, warnings and
# fallbacks (#6195, #10057) are the lines of the original step, and the only
# edits are the variable plumbing at the top and the merge_group additions.
#
# ## The interface
#
#   OS_SHARD_EVENT_NAME             `github.event_name`
#   OS_SHARD_PR_BASE_REF            `github.event.pull_request.base.ref`
#   OS_SHARD_PR_PINNED_BASE_SHA     `github.event.pull_request.base.sha` -- the
#                                   payload's FROZEN base, printed for the drift
#                                   reading and never diffed from (#6195)
#   OS_SHARD_MERGE_GROUP_BASE_SHA   `github.event.merge_group.base_sha`
#   RUNNER_TEMP                     the runner's temp dir; the outputs land here
#
# Variables absent from the event are empty strings, which is what the runner
# hands over for an expression that does not apply to the event -- so a local
# run sets only the ones its event carries.
set -euo pipefail

if [ -z "${RUNNER_TEMP:-}" ]; then
  echo "usage: RUNNER_TEMP=<dir> OS_SHARD_EVENT_NAME=<event> [OS_SHARD_PR_BASE_REF=… OS_SHARD_PR_PINNED_BASE_SHA=… OS_SHARD_MERGE_GROUP_BASE_SHA=…] bash scripts/ci/select-shard-packages.sh" >&2
  exit 2
fi

# Every path below is repo-relative (`scripts/...`, `pnpm exec`), so stand on
# the repository root whatever directory the caller stood on.
cd "$(git rev-parse --show-toplevel)"

EVENT_NAME="${OS_SHARD_EVENT_NAME:-}"
BASE_REF="${OS_SHARD_PR_BASE_REF:-}"
PINNED_BASE_SHA="${OS_SHARD_PR_PINNED_BASE_SHA:-}"
MERGE_GROUP_BASE_SHA="${OS_SHARD_MERGE_GROUP_BASE_SHA:-}"

SCM_BASE=''
if [ "$EVENT_NAME" = "pull_request" ]; then
  if [ -z "$BASE_REF" ]; then
    echo "::warning::This pull_request event carries no base branch, so the affected-set diff base cannot be computed."
  else
    # `fetch-depth: 0` above already makes this resolve — the fetch is
    # the guard for the day that changes, not the normal path.
    #
    # `git cat-file -e` rather than the more idiomatic strict
    # `git rev-parse --verify` spelling. That is history rather than
    # style, and it is written down because it used to be a live
    # hazard: the pre-#6589 check-shard-attestation.mjs classified a
    # job as an aggregate GATE when the script's basename and its
    # `--verify` flag merely CO-OCCURRED as substrings anywhere in
    # the job's joined `run:` text. This job always carries the
    # basename (its `--emit` step at the bottom), so spelling
    # `--verify` anywhere in this step — comments included, since
    # they were part of `run:` — silently reclassified the shard job
    # as a gate.
    #
    # #6589 closed that by construction. Classification is now by
    # INVOCATION: within one command the flag must follow the
    # script's own name as an argument, the test is applied per STEP
    # and never over the job's joined text, and the lexer drops shell
    # comments — all three pinned by that script's `--self-test`,
    # which is why this comment can now name the flag at all. Either
    # spelling is safe here; `git cat-file -e` stays because
    # churning it would buy nothing.
    if ! git cat-file -e "refs/remotes/origin/$BASE_REF^{commit}" 2>/dev/null; then
      git fetch --no-tags --quiet origin "+refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF" \
        || echo "::warning::Could not fetch origin/$BASE_REF; the merge-base resolution below will decide."
    fi
    # `if !` rather than a bare assignment on purpose: these steps run
    # under `bash -e`, where a failing command substitution kills the
    # step with no message at all.
    if ! SCM_BASE=$(git merge-base "refs/remotes/origin/$BASE_REF" HEAD); then
      SCM_BASE=''
    fi
  fi
fi
# merge_group (#16453): the payload names the base outright, so there is no
# merge-base to compute and no frozen sha to drift from. `base_sha` is an
# ancestor of HEAD -- the queue built HEAD by merging this entry onto it --
# and `git diff base_sha HEAD` is exactly what this entry adds. Every failure
# shape mirrors the pull_request branch above: an absent field, a sha the
# checkout cannot resolve even after a fetch, and further down a failed scan
# all fall back to the FULL list with a `::warning::` naming the reason,
# never to a silent narrower set.
if [ "$EVENT_NAME" = "merge_group" ]; then
  if [ -z "$MERGE_GROUP_BASE_SHA" ]; then
    echo "::warning::This merge_group event carries no base_sha, so the affected-set diff base cannot be computed."
  else
    # The checkout's `fetch-depth: 0` already makes this resolve -- the fetch
    # is the guard for the day that changes, exactly as it is above. Fetched
    # by sha, not by ref: a merge group's base is a commit, and the queue
    # branch it sits on is transient.
    if ! git cat-file -e "$MERGE_GROUP_BASE_SHA^{commit}" 2>/dev/null; then
      git fetch --no-tags --quiet origin "$MERGE_GROUP_BASE_SHA" \
        || echo "::warning::Could not fetch the merge group's base $MERGE_GROUP_BASE_SHA; the resolution below will decide."
    fi
    if git cat-file -e "$MERGE_GROUP_BASE_SHA^{commit}" 2>/dev/null; then
      SCM_BASE="$MERGE_GROUP_BASE_SHA"
    fi
  fi
fi
if [ -n "$SCM_BASE" ]; then
  if [ "$EVENT_NAME" = "pull_request" ]; then
    # The drift is printed, not just corrected: nothing in this log ever
    # said which commit the affected diff started from, which is why the
    # decay was invisible.
    DRIFT=$(git rev-list --count "$PINNED_BASE_SHA..$SCM_BASE" 2>/dev/null || echo '?')
    echo "Affected-set diff base: $SCM_BASE  (merge-base of origin/$BASE_REF and HEAD)"
    echo "Frozen payload base.sha: $PINNED_BASE_SHA  -- $BASE_REF has moved $DRIFT commit(s) since it was frozen, and that drift is exactly what this step used to charge to this PR."
  else
    echo "Affected-set diff base: $SCM_BASE  (the merge group's base_sha)"
  fi
  TURBO_SCM_BASE="$SCM_BASE" pnpm exec turbo ls --affected --output=json > "$RUNNER_TEMP/turbo-ls.json"
  # `turbo ls --affected` answers "which packages does the dependency
  # GRAPH reach from this diff" — and some suites read files the graph
  # does not connect them to. spec's api-methods-batch-conformance scan
  # walks every `*.object.ts` in the monorepo while spec declares no
  # dependency on the packages it judges (nor should it: the scan reads
  # source text precisely to avoid inverting the spec -> * direction).
  # A platform-objects-only diff therefore left it unrun, and #7769
  # landed a violation on `main` that only PRs touching `spec` ever saw.
  # Measured on turbo 2.10.7: 51 packages affected by that diff, spec
  # not among them.
  #
  # So packages that declare a cross-package input radius are unioned
  # back in when the diff touches it. The declarations, and the static
  # detector that refuses to let a new cross-package scan go
  # undeclared, live in the script (`pnpm check:cross-package-test-inputs`).
  #
  # Failure here falls back to the FULL package list, never to the
  # affected-only set: same posture as the merge-base fallback below
  # (#6195), and the same reason — the full list is a strict superset,
  # so doubt costs minutes rather than coverage. This is the FILTER
  # CONTRACT's half 1 applied one layer down.
  if ! git diff --name-only "$SCM_BASE" HEAD > "$RUNNER_TEMP/changed-files.txt" \
    || ! node scripts/check-cross-package-test-inputs.mjs \
         --union-into "$RUNNER_TEMP/turbo-ls.json" \
         --changed "$RUNNER_TEMP/changed-files.txt"; then
    echo "::warning::Could not union cross-package scans into the affected set; falling back to the full package list for this shard."
    pnpm exec turbo ls --output=json > "$RUNNER_TEMP/turbo-ls.json"
  # A fourth signal the failure branches do not cover: a producer that
  # exits 0 with a wrong, plausible, EMPTY answer. Only that `git
  # diff`'s exit STATUS was checked, never its emptiness, so a
  # merge-base resolving to something wrong-but-valid gave an empty
  # changed-file list -> zero affected packages -> a green shard that
  # tested nothing, with every log line reading like a normal quiet PR
  # (#10057). The shard attestation (#6082) does not cover it: it
  # attests "shard N ran and every step passed", which is exactly what
  # a shard that tested nothing does.
  #
  # Empty is decidable as BROKEN here, and only here: a pull_request
  # always differs from its merge-base. At the partitioner zero is
  # frequently the CORRECT answer (a docs-only PR genuinely affects no
  # package, and with 6 shards a small change legitimately leaves
  # shards empty), so a blanket "red on empty" belongs there least of
  # all -- this is the one place selection-failed and nothing-selected
  # can be told apart.
  #
  # Scoping this to pull_request is an explicit test now that merge_group
  # reaches this branch too (#16453): a merge group whose diff against its
  # base lists nothing is a group whose tree IS its base's tree -- already
  # validated as main, nothing new to test -- so selecting nothing there is
  # the honest answer, not the #10057 shape. push never reaches this branch:
  # SCM_BASE is assigned only under the two event guards above.
  elif [ "$EVENT_NAME" = "pull_request" ] && [ ! -s "$RUNNER_TEMP/changed-files.txt" ]; then
    echo "::warning::The diff against merge-base $SCM_BASE listed no changed files, which a pull_request cannot legitimately produce; falling back to the full package list for this shard rather than selecting nothing (#10057)."
    pnpm exec turbo ls --output=json > "$RUNNER_TEMP/turbo-ls.json"
  fi
else
  # Falling back to the FULL package list, never to the frozen
  # base.sha. This is not the #4690 silent-skip anti-pattern: that is
  # about a gate PASSING on input it could not read, and the full list
  # is a strict superset of the affected one — this shard still runs
  # everything it would have run and more. Cost is minutes; the
  # alternative is a red Test Core on a PR with nothing wrong with it.
  # Push builds take this branch by design: a push to main gates nobody, and
  # its full run is the ground truth the shard-timings refresh reads. Merge
  # groups used to take it too; since #16453 they land here only when the
  # group's base could not be resolved, and say so just below.
  if [ "$EVENT_NAME" = "pull_request" ]; then
    echo "::warning::Could not resolve merge-base(origin/$BASE_REF, HEAD); falling back to the full package list for this shard rather than diffing from the frozen base.sha (#6195)."
  fi
  if [ "$EVENT_NAME" = "merge_group" ]; then
    echo "::warning::Could not resolve the merge group's base '$MERGE_GROUP_BASE_SHA' in this checkout; falling back to the full package list for this shard rather than selecting nothing (#16453)."
  fi
  pnpm exec turbo ls --output=json > "$RUNNER_TEMP/turbo-ls.json"
fi
