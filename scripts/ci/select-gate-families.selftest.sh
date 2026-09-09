#!/usr/bin/env bash
#
# Self-test for scripts/ci/select-gate-families.sh (#16496).
#
# The script decides which scoped `Lint & Repo Gates` families a merge group
# or pull request pays for, and its one invariant is FAIL-OPEN: every doubt
# runs every family. So the property under test is not "does it exit 0" (it
# nearly always does) but WHICH families it ran and skipped, for WHICH reason,
# which `::warning::` lines it printed and which it must not, and what landed
# in `gate-families.txt` / `$GITHUB_OUTPUT` / `$GITHUB_STEP_SUMMARY`. The
# card's four minimum cases are here by name -- a scripts/pm/ change, a
# docs-only group, a workflow change, an unknown path -- and the fail-open
# branches around them: empty diff, unresolvable base, structural change,
# unspellable path, an event that is not scoped.
#
# The last section reads the REAL lint.yml and pins the YAML half of the
# contract: the selector step exists under the id the `if:` lines name, every
# scoped step spells `!= 'skip'` (an absent output runs the step), and the set
# of families the workflow scopes equals the set the script decides -- a
# family the script emits that no step reads is dead, and a step reading a
# family the script never emits would run unconditionally while looking
# scoped.
#
# Hermetic and offline: a throwaway upstream + clone (+ a shallow clone)
# under $TMPDIR; no fake tools are needed because the script calls nothing
# but git. Needs git and bash; ~3s.
#
# Run: bash scripts/ci/select-gate-families.selftest.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

# The two repo paths this self-test reads, spelled as quoted repo-relative
# literals on purpose: the dispatch derivation (scripts/pm/dispatch-gates.mjs)
# reads a gate's quoted path literals as the population it watches, so a card
# touching either schedules this family. Every other path below is a
# throwaway fixture under $TMPDIR, and none is spelled as a bare repo path --
# a quoted literal with a slash in it would read as a declared population
# that reaches nothing (check:declared-population-live refuses exactly that).
SCRIPT_REL='scripts/ci/select-gate-families.sh'
WORKFLOW_REL='.github/workflows/lint.yml'
SCRIPT="$PWD/$SCRIPT_REL"
FIX=$(mktemp -d "${TMPDIR:-/tmp}/os-select-gate-families-selftest.XXXXXX") || exit 1
trap 'rm -rf "$FIX"' EXIT INT TERM

fail=0
cases=0
checks=0

git_q() {
  git -c user.name=selftest -c user.email=selftest@example.invalid -c commit.gpgsign=false "$@"
}

ALL='pm_dispatch_gates query_options_erasure slot_lookup verify_lock comment_mask_corpus'

# ── Fixture repositories ────────────────────────────────────────────────────
# C0 carries one representative file of every class the classifier names, so
# a scenario is "modify / add / delete one of them on top of C0".
UP="$FIX/upstream"
mkdir -p "$UP"
git_q -C "$UP" init -q
git_q -C "$UP" symbolic-ref HEAD refs/heads/main
mkdir -p "$UP/packages/a/scripts" "$UP/packages/a/src" "$UP/apps/site/src" "$UP/docs" "$UP/content/docs" \
  "$UP/scripts/pm" "$UP/scripts/ci" "$UP/.github/workflows" "$UP/.claude/agents" "$UP/skills/x" "$UP/.changeset"
printf '{"name":"fixture","private":true}\n' > "$UP/package.json"
printf 'packages:\n  - packages/*\n' > "$UP/pnpm-workspace.yaml"
printf '{"name":"a"}\n' > "$UP/packages/a/package.json"
printf 'export const a = 1;\n' > "$UP/packages/a/src/index.ts"
printf 'export const t = 1;\n' > "$UP/packages/a/src/index.test.ts"
printf '{"rows":[]}\n' > "$UP/packages/a/src/data.json"
printf '#!/usr/bin/env bash\necho foo\n' > "$UP/packages/a/foo.sh"
printf 'dist/\n' > "$UP/packages/a/.gitignore"
printf 'console.log(1);\n' > "$UP/packages/a/scripts/build.mjs"
printf 'export const site = 1;\n' > "$UP/apps/site/src/page.tsx"
printf '# guide\n' > "$UP/docs/guide.md"
printf '# page\n' > "$UP/content/docs/page.mdx"
printf '#!/usr/bin/env bash\necho lock\n' > "$UP/scripts/pm/os-verify-lock.sh"
printf 'export const pm = 1;\n' > "$UP/scripts/pm/tool.mjs"
printf '# pm\n' > "$UP/scripts/pm/README.md"
printf 'export const helper = 1;\n' > "$UP/scripts/helper.mjs"
printf '{}\n' > "$UP/scripts/slot-lookup-baseline.json"
printf '#!/usr/bin/env bash\necho ci\n' > "$UP/scripts/ci/tool.sh"
printf 'name: lint\n' > "$UP/.github/workflows/lint.yml"
printf '# agent\n' > "$UP/.claude/agents/os-dev.md"
printf '# skill\n' > "$UP/skills/x/SKILL.md"
printf '# rules\n' > "$UP/AGENTS.md"
printf '# readme\n' > "$UP/README.md"
printf -- '---\n"a": patch\n---\nchange\n' > "$UP/.changeset/first.md"
git_q -C "$UP" add -A
git_q -C "$UP" commit -q -m 'C0: root'
C0=$(git_q -C "$UP" rev-parse HEAD)
printf '# guide, revised upstream\n' > "$UP/docs/guide.md"
git_q -C "$UP" commit -q -am 'C1: docs move on main'
C1=$(git_q -C "$UP" rev-parse HEAD)
# A merge group's base is fetched BY SHA; a local upstream has to be told to
# serve one (GitHub does so for every reachable commit).
git_q -C "$UP" config uploadpack.allowReachableSHA1InWant true
git_q -C "$UP" config uploadpack.allowAnySHA1InWant true

REPO="$FIX/repo"
git_q clone -q "$UP" "$REPO"
# Created AFTER the clone, so the clone has no refs/remotes/origin/release:
# the pull_request fetch path has something to fetch.
git_q -C "$UP" branch release "$C0"

SHALLOW="$FIX/shallow"
git_q clone -q --depth 1 "file://$UP" "$SHALLOW" 2>/dev/null

ZEROS=0000000000000000000000000000000000000000

# scenario <edits...>  -- a detached commit on top of C0 in $REPO carrying the
# edits, each spelled `M:<rel>` (modify), `A:<rel>` (add), `D:<rel>` (delete),
# `R:<from>:<to>` (rename). Prints the commit sha.
scenario() {
  git_q -C "$REPO" checkout -q --detach "$C0"
  local edit kind rel to
  for edit in "$@"; do
    kind=${edit%%:*}
    rel=${edit#*:}
    case "$kind" in
      M) printf '%s\n' "revised $RANDOM" >> "$REPO/$rel" ;;
      A) mkdir -p "$(dirname "$REPO/$rel")"; printf 'added\n' > "$REPO/$rel" ;;
      D) rm -f "$REPO/$rel" ;;
      R) to=${rel#*:}; rel=${rel%%:*}; mkdir -p "$(dirname "$REPO/$to")"; mv "$REPO/$rel" "$REPO/$to" ;;
    esac
  done
  git_q -C "$REPO" add -A
  git_q -C "$REPO" commit -q -m "scenario: $*"
  git_q -C "$REPO" rev-parse HEAD
}

# ── The runner and the assertions ───────────────────────────────────────────
RT=''
rc=0
# run_case <label> <cwd> <event> <pr base ref> <merge-group base sha>
run_case() {
  label=$1
  cases=$((cases + 1))
  RT="$FIX/rt-$cases"
  mkdir -p "$RT"
  : > "$RT/github-output"
  : > "$RT/step-summary"
  (
    cd "$2" && RUNNER_TEMP="$RT" GITHUB_OUTPUT="$RT/github-output" GITHUB_STEP_SUMMARY="$RT/step-summary" \
      OS_GATE_EVENT_NAME="$3" OS_GATE_PR_BASE_REF="$4" OS_GATE_MERGE_GROUP_BASE_SHA="$5" \
      bash "$SCRIPT"
  ) > "$RT/out.txt" 2>&1
  rc=$?
  echo "case: $label"
}

# Captured script output is echoed INDENTED: the Actions runner parses a
# `::warning::` at line start into a real annotation, and the failing case
# must not mint one on the lint job's behalf.
show_output() {
  echo "        -- output --"
  sed 's/^/        | /' "$RT/out.txt"
  if [ -s "$RT/gate-families.txt" ]; then
    echo "        -- gate-families.txt --"
    sed 's/^/        | /' "$RT/gate-families.txt"
  fi
}

ok() { checks=$((checks + 1)); printf '  ok    %s\n' "$1"; }
bad() {
  checks=$((checks + 1))
  fail=1
  printf '  FAIL  %s\n' "$1"
  shift
  while [ $# -gt 0 ]; do printf '        %s\n' "$1"; shift; done
  show_output
}

expect_rc() {
  if [ "$rc" -eq "$1" ]; then ok "exit $1"; else bad "exit $1" "got exit $rc"; fi
}

# expect_file_is <label> <file> <expected content, newline-separated>
expect_file_is() {
  printf '%s' "$3" > "$RT/want.txt"
  if [ -n "$3" ]; then printf '\n' >> "$RT/want.txt"; fi
  if diff -u "$RT/want.txt" "$2" > "$RT/diff.txt"; then
    ok "$1"
  else
    bad "$1" "$(sed 's/^/diff: /' "$RT/diff.txt" | tr '\n' ' ')"
  fi
}

expect_warnings() {
  grep '^::warning::' "$RT/out.txt" > "$RT/warnings.txt"
  expect_file_is "warnings: ${1:-none}" "$RT/warnings.txt" "$2"
}
expect_line() {
  if grep -qF -- "$1" "$RT/out.txt"; then ok "prints: $1"; else bad "prints: $1"; fi
}
expect_no_line() {
  if grep -qF -- "$1" "$RT/out.txt"; then bad "does not print: $1"; else ok "does not print: $1"; fi
}

# The verdict per family, as `id=run|skip` lines in family order -- read from
# gate-families.txt AND from the $GITHUB_OUTPUT file, which must agree.
verdicts() { awk '{ print $1 "=" $2 }' "$RT/gate-families.txt"; }
# expect_verdicts <run ids...> -- every family in ALL is expected `run` when
# named, `skip` otherwise.
expect_verdicts() {
  local id want='' v
  for id in $ALL; do
    v=skip
    case " $* " in *" $id "*) v=run ;; esac
    want="$want$id=$v"$'\n'
  done
  want=${want%$'\n'}
  printf '%s\n' "$want" > "$RT/want-verdicts.txt"
  if [ "$(verdicts)" = "$want" ]; then
    ok "verdicts: run={$*}"
  else
    bad "verdicts: run={$*}" "got: $(verdicts | tr '\n' ' ')"
  fi
  if [ "$(cat "$RT/github-output")" = "$want" ]; then
    ok 'GITHUB_OUTPUT carries the same verdicts'
  else
    bad 'GITHUB_OUTPUT carries the same verdicts' "got: $(tr '\n' ' ' < "$RT/github-output")"
  fi
}
expect_all_run() { expect_verdicts $ALL; }
# expect_reason <id> <fragment>
expect_reason() {
  if awk -v id="$1" '$1 == id { $1 = ""; $2 = ""; print }' "$RT/gate-families.txt" | grep -qF -- "$2"; then
    ok "$1 reason mentions: $2"
  else
    bad "$1 reason mentions: $2" "got: $(awk -v id="$1" '$1 == id' "$RT/gate-families.txt")"
  fi
}
expect_changed() { expect_file_is "changed files: $1" "$RT/gate-changed-files.txt" "$2"; }

echo "select-gate-families selftest  (fixture: C0=${C0:0:7} C1=${C1:0:7})"

# ── usage and --families ────────────────────────────────────────────────────
cases=$((cases + 1)); RT="$FIX/rt-$cases"; mkdir -p "$RT"
(cd "$REPO" && env -u RUNNER_TEMP OS_GATE_EVENT_NAME=push bash "$SCRIPT") > "$RT/out.txt" 2>&1
rc=$?
echo "case: usage: no RUNNER_TEMP is a usage error, not a selection"
expect_rc 2
expect_line 'usage: RUNNER_TEMP='

cases=$((cases + 1)); RT="$FIX/rt-$cases"; mkdir -p "$RT"
(cd "$REPO" && bash "$SCRIPT" --families) > "$RT/out.txt" 2>&1
rc=$?
echo "case: --families prints the family ids in job order"
expect_rc 0
expect_file_is 'the five ids' "$RT/out.txt" "$(printf '%s\n' $ALL)"

# ── events that are not scoped ──────────────────────────────────────────────
S=$(scenario M:docs/guide.md)
run_case 'push: every family runs, no warning -- the full battery by design' "$REPO" push '' ''
expect_rc 0
expect_warnings '' ''
expect_all_run
expect_reason pm_dispatch_gates "event 'push' is not scoped"
expect_line 'Gate families: 5 run, 0 skipped'

run_case 'schedule: every family runs (the hourly full run keeps the battery)' "$REPO" schedule '' ''
expect_rc 0
expect_warnings '' ''
expect_all_run

run_case 'no event at all: every family runs' "$REPO" '' '' ''
expect_rc 0
expect_all_run
expect_reason verify_lock "event '<none>' is not scoped"

run_case 'push: the event decides, not the variables that happen to be set' "$REPO" push main "$C0"
expect_rc 0
expect_all_run

# ── merge_group: the card's four cases ──────────────────────────────────────
S=$(scenario M:scripts/pm/tool.mjs)
run_case 'merge_group: a scripts/pm change runs the PM dispatch-gates self-test (and, for a .mjs, the corpus walk)' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
expect_verdicts pm_dispatch_gates comment_mask_corpus
expect_reason pm_dispatch_gates 'scripts/pm/tool.mjs (M, scripts)'
expect_changed 'one M' "M scripts/pm/tool.mjs"
expect_line "Gate-family diff base: $C0  (the merge group's base_sha)"
expect_line 'Gate families: 2 run, 3 skipped'

S=$(scenario M:scripts/pm/README.md)
run_case 'merge_group: a scripts/pm prose change runs the PM dispatch-gates self-test alone' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
expect_verdicts pm_dispatch_gates
expect_line 'Gate families: 1 run, 4 skipped'

S=$(scenario M:docs/guide.md M:content/docs/page.mdx M:.changeset/first.md M:README.md)
run_case 'merge_group: a docs-only group skips every family, and prints it' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
expect_verdicts
expect_reason pm_dispatch_gates 'no changed path is in its read-set'
expect_line 'Gate families: 0 run, 5 skipped'
expect_line 'skip  pm_dispatch_gates'
expect_line 'skip  comment_mask_corpus'
if grep -q '^| `pm_dispatch_gates` | skip |' "$RT/step-summary" && grep -q '^## Gate families: 0 run, 5 skipped' "$RT/step-summary"; then
  ok 'the step summary lists the skipped families'
else
  bad 'the step summary lists the skipped families' "$(tr '\n' ' ' < "$RT/step-summary")"
fi

S=$(scenario M:.github/workflows/lint.yml)
run_case 'merge_group: a workflow change runs the PM dispatch-gates self-test' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
expect_verdicts pm_dispatch_gates
expect_reason pm_dispatch_gates '(M, workflow)'

S=$(scenario M:docs/guide.md A:brand-new-dir/thing.txt)
run_case 'merge_group: an UNKNOWN path runs every family' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
expect_all_run
expect_reason slot_lookup "unclassified path 'brand-new-dir/thing.txt'"

S=$(scenario M:lychee.toml)
run_case 'merge_group: an unlisted ROOT file is unknown too' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_all_run
expect_reason comment_mask_corpus "unclassified path 'lychee.toml'"

# ── merge_group: fail-open on structure and shape ──────────────────────────
S=$(scenario D:docs/guide.md)
run_case 'merge_group: a DELETION anywhere runs every family (structural)' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
expect_all_run
expect_reason verify_lock 'structural change (D docs/guide.md)'

S=$(scenario R:docs/guide.md:docs/guide-renamed.md)
run_case 'merge_group: a RENAME arrives as D + A and runs every family' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_all_run
expect_reason verify_lock 'structural change (D docs/guide.md)'
expect_changed 'D then A, no R record' "A docs/guide-renamed.md
D docs/guide.md"

S=$(scenario A:docs/new-page.md)
run_case 'merge_group: an ADDED docs file runs the name-sweeping family only' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
expect_verdicts pm_dispatch_gates
expect_reason pm_dispatch_gates 'docs/new-page.md (A, docs)'

git_q -C "$REPO" checkout -q --detach "$C0"
run_case 'merge_group: an EMPTY diff runs every family rather than selecting nothing' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '#10057' "::warning::The diff against $C0 listed no changed files; every gate family runs rather than selecting nothing (#10057)."
expect_all_run
expect_changed 'empty' ''

S=$(scenario M:docs/guide.md)
run_case 'merge_group: no base_sha in the payload' "$REPO" merge_group '' ''
expect_rc 0
expect_warnings 'no base' '::warning::This merge_group event carries no base_sha, so the gate-family diff base cannot be computed; every family runs.'
expect_all_run
expect_reason pm_dispatch_gates 'no base_sha in the merge_group event'

run_case 'merge_group: an unfetchable base_sha warns twice and runs everything' "$REPO" merge_group '' "$ZEROS"
expect_rc 0
expect_warnings 'fetch + resolve' "::warning::Could not fetch the merge group's base $ZEROS; the resolution below will decide.
::warning::Could not resolve the merge group's base '$ZEROS' in this checkout; every gate family runs rather than guessing which paths changed (#16453)."
expect_all_run

if git_q -C "$SHALLOW" cat-file -e "$C0^{commit}" 2>/dev/null; then
  bad 'precondition: the shallow clone lacks C0 before the fetch case'
else
  ok 'precondition: the shallow clone lacks C0 before the fetch case'
fi
run_case 'merge_group: a base_sha absent from a shallow checkout is fetched BY SHA, then decided' "$SHALLOW" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
if git_q -C "$SHALLOW" cat-file -e "$C0^{commit}" 2>/dev/null; then
  ok 'C0 is present after the run (the fetch happened)'
else
  bad 'C0 is present after the run (the fetch happened)'
fi
expect_verdicts
expect_changed 'the docs edit C0..C1' "M docs/guide.md"

S=$(scenario "A:docs/we$(printf '\t')ird.md")
if git_q -C "$REPO" ls-files -z | tr '\0' '\n' | grep -q 'docs/we.ird\.md'; then
  ok 'precondition: the fixture carries a path with a control character'
else
  bad 'precondition: the fixture carries a path with a control character'
fi
run_case 'merge_group: a path the script cannot spell runs every family' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings 'unspellable' '::warning::A changed path carries a control character and cannot be classified; every gate family runs.'
expect_all_run

# ── merge_group: the per-family read-sets ──────────────────────────────────
S=$(scenario M:packages/a/src/index.ts)
run_case 'merge_group: a packages TS edit runs both ratchets, the corpus AND the PM self-test (it reads every source), not the lock self-test' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
expect_verdicts pm_dispatch_gates query_options_erasure slot_lookup comment_mask_corpus
expect_reason query_options_erasure '(M, workspace)'
expect_reason comment_mask_corpus packages/a/src/index.ts
expect_reason pm_dispatch_gates packages/a/src/index.ts

S=$(scenario M:apps/site/src/page.tsx)
run_case 'merge_group: an apps TSX edit is outside the ratchets (packages/** only) but inside the corpus and the PM census' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_verdicts pm_dispatch_gates comment_mask_corpus

S=$(scenario M:packages/a/package.json)
run_case 'merge_group: a package manifest runs the PM self-test and the lock self-test (workspace enumeration), no ratchet' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_verdicts pm_dispatch_gates verify_lock
expect_reason pm_dispatch_gates packages/a/package.json
expect_reason verify_lock packages/a/package.json

S=$(scenario M:packages/a/.gitignore)
run_case 'merge_group: a nested .gitignore runs the PM self-test (exposed-scratch-dir sweep) alone' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_verdicts pm_dispatch_gates
expect_reason pm_dispatch_gates packages/a/.gitignore

S=$(scenario M:packages/a/src/data.json)
run_case 'merge_group: a non-source, non-manifest workspace file skips every family' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
expect_verdicts

S=$(scenario M:packages/a/foo.sh)
run_case 'merge_group: a workspace shell script outside scripts/ is still gate source, not a skipped non-source workspace file (#16769)' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
expect_verdicts pm_dispatch_gates
expect_reason pm_dispatch_gates packages/a/foo.sh

S=$(scenario M:packages/a/scripts/build.mjs)
run_case 'merge_group: a package-local script is a gate source (PM) and a masked source (corpus)' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_verdicts pm_dispatch_gates comment_mask_corpus

S=$(scenario M:scripts/pm/os-verify-lock.sh)
run_case 'merge_group: the lock script runs its own self-test and the PM self-test' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_verdicts pm_dispatch_gates verify_lock
expect_reason verify_lock '(M, verify-lock)'

S=$(scenario M:scripts/helper.mjs)
run_case 'merge_group: a top-level scripts module is imported by the ratchets AND the lock preflight, and is a masked source' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_all_run
expect_reason verify_lock scripts/helper.mjs

S=$(scenario M:scripts/slot-lookup-baseline.json)
run_case 'merge_group: a ratchet baseline runs the ratchets and the PM self-test' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_verdicts pm_dispatch_gates query_options_erasure slot_lookup

S=$(scenario M:scripts/ci/tool.sh)
run_case 'merge_group: a scripts/ subdirectory script is a gate source only' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_verdicts pm_dispatch_gates

S=$(scenario M:.claude/agents/os-dev.md M:skills/x/SKILL.md M:AGENTS.md)
run_case 'merge_group: agent configuration runs the PM self-test only' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_verdicts pm_dispatch_gates

S=$(scenario M:package.json)
run_case 'merge_group: root configuration runs every family' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_warnings '' ''
expect_all_run
expect_reason verify_lock '(M, root-config)'

S=$(scenario M:pnpm-workspace.yaml)
run_case 'merge_group: the workspace manifest is root configuration too' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_all_run

S=$(scenario M:docs/guide.md M:packages/a/src/index.test.ts M:.github/workflows/lint.yml)
run_case 'merge_group: a mixed group runs the union of what its paths reach' "$REPO" merge_group '' "$C0"
expect_rc 0
expect_verdicts pm_dispatch_gates query_options_erasure slot_lookup comment_mask_corpus
expect_line 'Gate families: 4 run, 1 skipped'

# ── pull_request ────────────────────────────────────────────────────────────
git_q -C "$REPO" checkout -q -B feature "$C0"
printf '# guide, on the feature branch\n' > "$REPO/docs/guide.md"
git_q -C "$REPO" commit -q -am 'F1: docs on the feature branch'
F1=$(git_q -C "$REPO" rev-parse HEAD)
run_case 'pull_request: decided against merge-base(origin/main, HEAD)' "$REPO" pull_request main ''
expect_rc 0
expect_warnings '' ''
expect_verdicts
expect_line "Gate-family diff base: $C0  (merge-base of origin/main and HEAD)"
expect_changed 'the feature edit only, not C1' "M docs/guide.md"

run_case 'pull_request: no base branch in the payload' "$REPO" pull_request '' ''
expect_rc 0
expect_warnings 'no base' '::warning::This pull_request event carries no base branch, so the gate-family diff base cannot be computed; every family runs.'
expect_all_run

if git_q -C "$REPO" rev-parse -q --verify refs/remotes/origin/release > /dev/null; then
  bad 'precondition: origin/release is absent before the fetch case'
else
  ok 'precondition: origin/release is absent before the fetch case'
fi
run_case 'pull_request: a base ref absent locally is fetched, then decided' "$REPO" pull_request release ''
expect_rc 0
expect_warnings '' ''
if git_q -C "$REPO" rev-parse -q --verify refs/remotes/origin/release > /dev/null; then
  ok 'origin/release exists after the run (the fetch happened)'
else
  bad 'origin/release exists after the run (the fetch happened)'
fi
expect_verdicts

run_case 'pull_request: an unfetchable base ref warns twice and runs everything' "$REPO" pull_request nope ''
expect_rc 0
expect_warnings 'fetch + #6195' '::warning::Could not fetch origin/nope; the merge-base resolution below will decide.
::warning::Could not resolve merge-base(origin/nope, HEAD); every gate family runs rather than guessing which paths changed (#6195).'
expect_all_run

# ── The YAML half of the contract ───────────────────────────────────────────
# Read from the real workflow: the selector step, the `if:` spellings, and
# the family set. A stale or mis-spelled `if:` is invisible to every other
# gate (a step that always runs looks exactly like a step that was scoped and
# selected), so it is pinned here beside the script that feeds it.
cases=$((cases + 1))
echo "case: lint.yml wires the selector and scopes exactly the families the script decides"
WF="$PWD/$WORKFLOW_REL"
if grep -qE '^ {8}id: gate-families$' "$WF"; then ok 'the selector step carries id gate-families'; else bad 'the selector step carries id gate-families'; fi
if grep -qE "^ {10}bash $SCRIPT_REL$" "$WF"; then ok "the selector step runs $SCRIPT_REL"; else bad "the selector step runs $SCRIPT_REL"; fi
for var in OS_GATE_EVENT_NAME OS_GATE_PR_BASE_REF OS_GATE_MERGE_GROUP_BASE_SHA; do
  if grep -qE "^ {10}$var: \\$\\{\\{ github\\." "$WF"; then ok "the selector step exports $var"; else bad "the selector step exports $var"; fi
done
grep -oE "steps\.gate-families\.outputs\.[a-z_]+ *[!=]= *'[a-z]+'" "$WF" | sort > "$FIX/ifs.txt"
if grep -vqE " != 'skip'$" "$FIX/ifs.txt"; then
  bad "every scoped step spells \`!= 'skip'\` (an absent output runs the step)" "$(grep -vE " != 'skip'$" "$FIX/ifs.txt" | tr '\n' ' ')"
else
  ok "every scoped step spells \`!= 'skip'\` (an absent output runs the step)"
fi
if grep -qE "gate-families\.outputs\.[a-z_]+ *== *'run'" "$WF"; then
  bad "no step spells \`== 'run'\` (a fail-closed reading)"
else
  ok "no step spells \`== 'run'\` (a fail-closed reading)"
fi
sed -E "s/^steps\.gate-families\.outputs\.([a-z_]+).*/\1/" "$FIX/ifs.txt" | sort -u > "$FIX/scoped.txt"
bash "$SCRIPT" --families | sort -u > "$FIX/decided.txt"
if diff -u "$FIX/decided.txt" "$FIX/scoped.txt" > "$FIX/families.diff"; then
  ok "the workflow scopes exactly the families the script decides ($(wc -l < "$FIX/decided.txt" | tr -d ' '))"
else
  bad 'the workflow scopes exactly the families the script decides' "$(sed 's/^/diff: /' "$FIX/families.diff" | tr '\n' ' ')"
fi
if [ "$(grep -cE "steps\.gate-families\.outputs\.[a-z_]+ != 'skip'" "$WF")" -eq "$(wc -l < "$FIX/decided.txt" | tr -d ' ')" ]; then
  ok 'each family gates exactly one step'
else
  bad 'each family gates exactly one step' "got $(grep -cE "steps\.gate-families\.outputs\.[a-z_]+ != 'skip'" "$WF") if: lines"
fi
# Each scoped step's `if:` must sit on the step running that family's command.
pin_step() {
  # pin_step <family> <command fragment>
  if awk -v fam="$1" -v cmd="$2" '
    index($0, "if: steps.gate-families.outputs." fam " != '"'"'skip'"'"'") { armed = NR }
    armed && NR > armed && NR <= armed + 2 && index($0, cmd) { found = 1 }
    END { exit found ? 0 : 1 }' "$WF"; then
    ok "$1 gates the step running: $2"
  else
    bad "$1 gates the step running: $2"
  fi
}
pin_step pm_dispatch_gates 'pnpm check:pm-dispatch-gates'
pin_step query_options_erasure 'pnpm check:query-options-erasure'
pin_step slot_lookup 'pnpm check:slot-lookup'
# Pinned by the script name alone: spelling the flag that step passes in code
# here would read, to check-self-test-wired, as a self-test flag of THIS file
# that no workflow passes.
pin_step verify_lock 'bash scripts/pm/os-verify-lock.sh'
pin_step comment_mask_corpus 'node scripts/check-comment-mask-corpus.mjs'

# ── Verdict ─────────────────────────────────────────────────────────────────
# #4690: a battery that ran nothing is a failure, never a pass.
if [ "$cases" -lt 30 ] || [ "$checks" -lt 120 ]; then
  echo "SELFTEST FAILED: only $cases case(s) / $checks check(s) ran -- the battery is short"
  exit 1
fi
if [ "$fail" -ne 0 ]; then
  echo "SELFTEST FAILED ($cases cases, $checks checks)"
  exit 1
fi
echo "all $cases cases passed ($checks checks)"
