#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# select-gate-families -- which scoped `Lint & Repo Gates` families this run
# pays for, decided from the event and the changed paths (#16496).
#
#   OS_GATE_EVENT_NAME=merge_group OS_GATE_MERGE_GROUP_BASE_SHA=<sha> \
#   RUNNER_TEMP=/tmp/rt bash scripts/ci/select-gate-families.sh
#   OS_GATE_EVENT_NAME=pull_request OS_GATE_PR_BASE_REF=main \
#   RUNNER_TEMP=/tmp/rt bash scripts/ci/select-gate-families.sh
#   bash scripts/ci/select-gate-families.sh --families   # the family ids, one per line
#   bash scripts/ci/select-gate-families.selftest.sh      # every branch, offline
#
# Environment in, three things out: $RUNNER_TEMP/gate-families.txt (one
# line per family: `<id> <run|skip> <reason>`), $RUNNER_TEMP/gate-changed-
# files.txt (the `<status> <path>` list the decision was taken over), and --
# when the runner provides them -- one `<id>=run|skip` line per family
# appended to `$GITHUB_OUTPUT` and a table appended to `$GITHUB_STEP_SUMMARY`.
# Exit 0 on every decided outcome; exit 2 on a usage error.
#
# ## The invariant: FAIL-OPEN
#
# This script makes a REQUIRED status check verify fewer families at merge
# time, and the single property that keeps that safe is that every doubt
# resolves to "run". Concretely, EVERY family runs when:
#
#   - the event is anything but `merge_group` or `pull_request` (`push` on
#     main and the scheduled full run keep the whole battery, by design);
#   - the diff base cannot be named or resolved, or `git diff` fails;
#   - the changed-file list is EMPTY (on a pull_request that is the #10057
#     shape -- a selection that produced nothing -- and on a merge group it is
#     a tree identical to its base; both are cheaper to re-verify than to
#     reason about);
#   - any changed path is one the classifier below does not recognise (a new
#     top-level directory, a root file nobody listed), or one it cannot spell
#     (a control character in the name);
#   - any change is STRUCTURAL: a deletion, rename, copy or type change. Two
#     of the families sweep the tracked NAME set (see the read-sets below),
#     and a name that disappears can move a verdict that no content read
#     would.
#
# A family is skipped ONLY when every changed path is, for that family, a
# path it provably does not read -- a positive classification into a class
# the family's read-set excludes. There is no "skip" default anywhere in this
# file: an unmatched `case` arm falls through to "run".
#
# ## The families and their read-sets (measured, see the PR that landed this)
#
# The workflow steps carry `if: steps.gate-families.outputs.<id> != 'skip'`,
# so an output that is absent -- the selector never ran, or ran and wrote
# nothing -- also runs the step. The YAML half of that contract is pinned by
# the self-test, which reads lint.yml and refuses any other spelling.
#
#   pm_dispatch_gates      `pnpm check:pm-dispatch-gates`. Its self-test
#                          discovers every workflow file, resolves every
#                          check:* script through the root and package
#                          `package.json`s, reads each gate's source for its
#                          watch hints (so ALL of scripts/** and every
#                          packages/*/scripts/**), reads .claude/**,
#                          skills/** (the frame-sync COPIES table),
#                          `AGENTS.md`, `CLAUDE.md`, `tsconfig.json`,
#                          .gitignore, and sweeps `git ls-files` for hint
#                          reachability and test-file residue. It also reads
#                          the CONTENT of every JS/TS and shell (`.sh`) file in
#                          the tree: the compound-anchor census of
#                          `function ...SelfTest...(` declarations asserts none
#                          is unlisted, and the exposed-scratch-dir sweep reads
#                          every mkdtempSync/mkdirSync caller and consults
#                          nested .gitignore files. So any masked source file,
#                          any `.sh` file, and any .gitignore runs it, and
#                          because the name sweep reads the tracked NAME set an
#                          ADDED file anywhere runs it too; only modifications
#                          of docs, changesets and non-source workspace files
#                          that are neither a manifest nor a script skip it.
#   query_options_erasure  `pnpm check:query-options-erasure`. Lints
#                          packages/**/*.{ts,tsx,mts,cts} under
#                          `eslint.config.mjs`, reads its baseline
#                          (scripts/query-options-erasure-baseline.json,
#                          at HEAD and at the merge base), and imports a few
#                          top-level scripts/*.mjs helpers.
#   slot_lookup            `pnpm check:slot-lookup`. Same shape and the same
#                          population, with scripts/slot-lookup-baseline.json.
#   verify_lock            `bash scripts/pm/os-verify-lock.sh --self-test`.
#                          Reads itself and a private temp dir, and its case
#                          (h) runs the real entry point from the repo root,
#                          which routes through filter_preflight ->
#                          scripts/pnpm-filter-targets.mjs --preflight: the
#                          top-level scripts/*.mjs helpers that imports,
#                          pnpm-workspace.yaml and every workspace
#                          package.json.
#   comment_mask_corpus    `node scripts/check-comment-mask-corpus.mjs`. Walks
#                          every `.ts .tsx .mts .cts .js .mjs .cjs .jsx` file
#                          in the tree outside build directories.
#
# Root configuration (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
# `turbo.json`, `tsconfig.json`, `eslint.config.mjs`, .gitignore,
# .gitattributes, .npmrc, .nvmrc) runs every family: a parser or
# dependency bump moves all of them. ESLint itself is not scoped (card
# ruling 2), nor is any step whose reads this file cannot name.
#
# ## The interface
#
#   OS_GATE_EVENT_NAME            `github.event_name`
#   OS_GATE_PR_BASE_REF           `github.event.pull_request.base.ref`
#   OS_GATE_MERGE_GROUP_BASE_SHA  `github.event.merge_group.base_sha`
#   RUNNER_TEMP                   the runner's temp dir; the outputs land here
#   GITHUB_OUTPUT                 optional; `<id>=run|skip` lines are appended
#   GITHUB_STEP_SUMMARY           optional; the ran/skipped table is appended
#
# Variables absent from the event are empty strings, which is what the runner
# hands over for an expression that does not apply -- a local run sets only
# the ones its event carries. Same shape as select-shard-packages.sh (#16453),
# whose self-test this one's mirrors.
set -euo pipefail

# The family ids, in the order the job runs them. `--families` prints them so
# the self-test can pin the workflow's `if:` set against this list without a
# second transcription.
FAMILIES='pm_dispatch_gates query_options_erasure slot_lookup verify_lock comment_mask_corpus'

if [ "${1:-}" = '--families' ]; then
  for id in $FAMILIES; do echo "$id"; done
  exit 0
fi

if [ -z "${RUNNER_TEMP:-}" ]; then
  echo "usage: RUNNER_TEMP=<dir> OS_GATE_EVENT_NAME=<event> [OS_GATE_PR_BASE_REF=… OS_GATE_MERGE_GROUP_BASE_SHA=…] bash scripts/ci/select-gate-families.sh" >&2
  echo "       bash scripts/ci/select-gate-families.sh --families" >&2
  exit 2
fi

# Every path below is repo-relative, so stand on the repository root whatever
# directory the caller stood on.
cd "$(git rev-parse --show-toplevel)"

EVENT_NAME="${OS_GATE_EVENT_NAME:-}"
BASE_REF="${OS_GATE_PR_BASE_REF:-}"
MERGE_GROUP_BASE_SHA="${OS_GATE_MERGE_GROUP_BASE_SHA:-}"

OUT="$RUNNER_TEMP/gate-families.txt"
CHANGED="$RUNNER_TEMP/gate-changed-files.txt"
: > "$OUT"
: > "$CHANGED"

# ── Emitting a decision ─────────────────────────────────────────────────────
# One writer for every outcome, so the three outputs cannot disagree.
# emit <id> <run|skip> <reason>
emit() {
  printf '%s %s %s\n' "$1" "$2" "$3" >> "$OUT"
}

# Decisions are accumulated in `$OUT` and published once, here: the outputs
# file, the step summary and the log line the seat reads.
publish() {
  local ran=0 skipped=0 id verdict reason
  while read -r id verdict reason; do
    if [ "$verdict" = skip ]; then skipped=$((skipped + 1)); else ran=$((ran + 1)); fi
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
      echo "$id=$verdict" >> "$GITHUB_OUTPUT"
    fi
  done < "$OUT"
  echo "Gate families: $ran run, $skipped skipped  (event: ${EVENT_NAME:-<none>}; changed paths: $(wc -l < "$CHANGED" | tr -d ' '))"
  while read -r id verdict reason; do
    printf '  %-5s %-22s %s\n' "$verdict" "$id" "$reason"
  done < "$OUT"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## Gate families: $ran run, $skipped skipped"
      echo
      echo "| family | verdict | why |"
      echo "|---|---|---|"
      while read -r id verdict reason; do
        printf '| `%s` | %s | %s |\n' "$id" "$verdict" "$reason"
      done < "$OUT"
      echo
      echo "Event \`${EVENT_NAME:-<none>}\`, $(wc -l < "$CHANGED" | tr -d ' ') changed path(s); selection by \`scripts/ci/select-gate-families.sh\` (#16496)."
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}

# run_everything <reason>  -- the fail-open exit: every family runs, one line
# says why, and the script exits 0 because a full battery is a decision, not
# a failure.
run_everything() {
  local id
  : > "$OUT"
  for id in $FAMILIES; do emit "$id" run "$1"; done
  publish
  exit 0
}

# ── Which event, which base ─────────────────────────────────────────────────
case "$EVENT_NAME" in
  merge_group|pull_request) ;;
  *)
    # Not a warning: `push` on main and the scheduled full run take this
    # branch by design, and a runner annotation on every one of them would
    # teach readers to skim the surface real fallbacks report into.
    run_everything "event '${EVENT_NAME:-<none>}' is not scoped -- the full battery runs"
    ;;
esac

SCM_BASE=''
if [ "$EVENT_NAME" = pull_request ]; then
  if [ -z "$BASE_REF" ]; then
    echo "::warning::This pull_request event carries no base branch, so the gate-family diff base cannot be computed; every family runs."
    run_everything 'no base branch in the pull_request event'
  fi
  # `fetch-depth: 0` already makes this resolve -- the fetch is the guard for
  # the day that changes, exactly as in select-shard-packages.sh.
  if ! git cat-file -e "refs/remotes/origin/$BASE_REF^{commit}" 2>/dev/null; then
    git fetch --no-tags --quiet origin "+refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF" \
      || echo "::warning::Could not fetch origin/$BASE_REF; the merge-base resolution below will decide."
  fi
  if ! SCM_BASE=$(git merge-base "refs/remotes/origin/$BASE_REF" HEAD 2>/dev/null); then
    SCM_BASE=''
  fi
  if [ -z "$SCM_BASE" ]; then
    echo "::warning::Could not resolve merge-base(origin/$BASE_REF, HEAD); every gate family runs rather than guessing which paths changed (#6195)."
    run_everything "merge-base(origin/$BASE_REF, HEAD) unresolvable"
  fi
  echo "Gate-family diff base: $SCM_BASE  (merge-base of origin/$BASE_REF and HEAD)"
fi
if [ "$EVENT_NAME" = merge_group ]; then
  if [ -z "$MERGE_GROUP_BASE_SHA" ]; then
    echo "::warning::This merge_group event carries no base_sha, so the gate-family diff base cannot be computed; every family runs."
    run_everything 'no base_sha in the merge_group event'
  fi
  if ! git cat-file -e "$MERGE_GROUP_BASE_SHA^{commit}" 2>/dev/null; then
    git fetch --no-tags --quiet origin "$MERGE_GROUP_BASE_SHA" \
      || echo "::warning::Could not fetch the merge group's base $MERGE_GROUP_BASE_SHA; the resolution below will decide."
  fi
  if ! git cat-file -e "$MERGE_GROUP_BASE_SHA^{commit}" 2>/dev/null; then
    echo "::warning::Could not resolve the merge group's base '$MERGE_GROUP_BASE_SHA' in this checkout; every gate family runs rather than guessing which paths changed (#16453)."
    run_everything "merge group base '$MERGE_GROUP_BASE_SHA' unresolvable"
  fi
  SCM_BASE="$MERGE_GROUP_BASE_SHA"
  echo "Gate-family diff base: $SCM_BASE  (the merge group's base_sha)"
fi

# ── The changed-file list ───────────────────────────────────────────────────
# `--name-status` rather than `--name-only`: the STATUS is a read-set input
# (structural changes run everything, additions run the name-sweeping family).
# `--no-renames` so a rename arrives as D + A and takes the structural branch
# by construction. `-z` so a path with a newline in it cannot forge a record;
# such a path is then refused below rather than classified.
if ! git diff --name-status --no-renames -z "$SCM_BASE" HEAD > "$RUNNER_TEMP/gate-diff.z" 2>/dev/null; then
  echo "::warning::git diff $SCM_BASE HEAD failed; every gate family runs."
  run_everything "git diff $SCM_BASE HEAD failed"
fi

unspellable=0
while IFS= read -r -d '' status && IFS= read -r -d '' path; do
  case "$path" in
    *[[:cntrl:]]*) unspellable=1; continue ;;
  esac
  printf '%s %s\n' "$status" "$path" >> "$CHANGED"
done < "$RUNNER_TEMP/gate-diff.z"

if [ "$unspellable" -ne 0 ]; then
  echo "::warning::A changed path carries a control character and cannot be classified; every gate family runs."
  run_everything 'a changed path cannot be spelled'
fi
if [ ! -s "$CHANGED" ]; then
  echo "::warning::The diff against $SCM_BASE listed no changed files; every gate family runs rather than selecting nothing (#10057)."
  run_everything "the diff against $SCM_BASE listed no changed files"
fi

# ── Classification ──────────────────────────────────────────────────────────
# classify <path>  -- prints ONE class name. Every class named here is a set
# of paths whose readers are known; `unknown` is the honest answer for the
# rest and runs every family. Ordered: the first matching arm wins.
classify() {
  case "$1" in
    .github/*)                       echo workflow ;;
    scripts/pm/os-verify-lock.sh)    echo verify-lock ;;
    scripts/*)                       echo scripts ;;
    .claude/*|skills/*)              echo agent-config ;;
    AGENTS.md|CLAUDE.md)             echo agent-config ;;
    .changeset/*.md)                 echo changeset ;;
    content/*|docs/*)                echo docs ;;
    packages/*|apps/*|examples/*)    echo workspace ;;
    package.json|pnpm-lock.yaml|pnpm-workspace.yaml|turbo.json|tsconfig.json|eslint.config.mjs|.gitignore|.gitattributes|.npmrc|.nvmrc)
                                     echo root-config ;;
    */*)                             echo unknown ;;
    *.md)                            echo docs ;;
    *)                               echo unknown ;;
  esac
}

# The extension families. A path with no dot in its basename has no extension.
is_ts_source() {
  case "$1" in
    *.ts|*.tsx|*.mts|*.cts) return 0 ;;
  esac
  return 1
}
is_masked_source() {
  case "$1" in
    *.ts|*.tsx|*.mts|*.cts|*.js|*.mjs|*.cjs|*.jsx) return 0 ;;
  esac
  return 1
}

# family_reads <id> <status> <path> <class>  -- exit 0 when the family must
# run for this change. The *) arm of every `case` is "run": nothing here
# skips by omission.
family_reads() {
  local id=$1 status=$2 path=$3 class=$4
  case "$class" in unknown|root-config) return 0 ;; esac
  case "$id" in
    pm_dispatch_gates)
      [ "$status" = M ] || return 0
      # The self-test reads the CONTENT of every JS/TS file in the tree (the
      # compound-anchor census of `function ...SelfTest...(` declarations, the
      # exposed-scratch-dir sweep of every mkdtempSync/mkdirSync caller) and
      # every tracked `.sh` file (the same watch-hint extraction, run through
      # the comment mask), and consults nested .gitignore files, so any masked
      # source, any `.sh` file, and any .gitignore runs it whatever class it
      # sits in.
      is_masked_source "$path" && return 0
      case "$path" in *.sh) return 0 ;; esac
      case "$path" in */.gitignore) return 0 ;; esac
      case "$class" in
        docs|changeset) return 1 ;;
        workspace)
          case "$path" in
            */package.json|*/scripts/*) return 0 ;;
            *) return 1 ;;
          esac
          ;;
        *) return 0 ;;
      esac
      ;;
    query_options_erasure|slot_lookup)
      case "$class" in
        workspace)
          # Both ratchets lint `packages/**` only; apps/ and examples/ are
          # outside their LINT_TARGET.
          case "$path" in
            packages/*) is_ts_source "$path" && return 0; return 1 ;;
            *) return 1 ;;
          esac
          ;;
        scripts)
          case "$path" in
            scripts/*/*) return 1 ;;
            *.mjs|*.json) return 0 ;;
            *) return 1 ;;
          esac
          ;;
        docs|changeset|workflow|agent-config|verify-lock) return 1 ;;
        *) return 0 ;;
      esac
      ;;
    verify_lock)
      # Case (h) of its self-test runs `bash "$SELF" -c ...` from the real
      # repo root, which routes through filter_preflight ->
      # scripts/pnpm-filter-targets.mjs --preflight, importing top-level
      # scripts/*.mjs helpers and reading pnpm-workspace.yaml (root config)
      # plus every workspace package.json.
      case "$path" in
        */package.json) return 0 ;;
      esac
      case "$class" in
        verify-lock) return 0 ;;
        scripts)
          case "$path" in
            scripts/*/*) return 1 ;;
            *.mjs) return 0 ;;
            *) return 1 ;;
          esac
          ;;
        docs|changeset|workflow|agent-config|workspace) return 1 ;;
        *) return 0 ;;
      esac
      ;;
    comment_mask_corpus)
      is_masked_source "$path" && return 0
      case "$class" in
        docs|changeset|workflow|agent-config|scripts|workspace|verify-lock) return 1 ;;
        *) return 0 ;;
      esac
      ;;
    *) return 0 ;;
  esac
}

# ── The decision ────────────────────────────────────────────────────────────
structural=''
while read -r status path; do
  case "$status" in
    A|M) ;;
    *) structural="$status $path" ;;
  esac
done < "$CHANGED"
if [ -n "$structural" ]; then
  run_everything "structural change ($structural) -- deletions, renames and type changes run every family"
fi

for id in $FAMILIES; do
  reason=''
  while read -r status path; do
    class=$(classify "$path")
    if [ "$class" = unknown ]; then
      run_everything "unclassified path '$path' -- every family runs"
    fi
    if family_reads "$id" "$status" "$path" "$class"; then
      reason="reads $path ($status, $class)"
      break
    fi
  done < "$CHANGED"
  if [ -n "$reason" ]; then
    emit "$id" run "$reason"
  else
    emit "$id" skip "no changed path is in its read-set"
  fi
done
publish
