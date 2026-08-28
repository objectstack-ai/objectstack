#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# os-regen-merge.sh — the mechanized merge sequence for a branch that touches
# os-regen-driven generated artifacts. Run INSIDE the feature branch's worktree.
#
#   bash scripts/pm/os-regen-merge.sh
#   bash scripts/pm/os-regen-merge.sh --self-test   # verify this script
#
# ## Why a script (and why the ORDER is the whole point)
#
# Paths routed to `merge=os-regen` in .gitattributes merge with exit 0 and zero
# conflict markers while SILENTLY DROPPING one side's changes — only a full
# regeneration exposes the loss. And running `gen:schema` while the tree is
# still in MERGE state silently rolls the authorable-surface anchor back to the
# branch's old fork point; the rolled-back anchor is still *authentic*, so every
# gate passes while a landed advance is quietly undone. Both traps are ordering
# traps, so the fix is a fixed order, executed mechanically:
#
#   1. git merge origin/main               (⛔ never rebase / force-push)
#   2. take main's side of every os-regen path THE BRANCH HAS NOT EDITED
#      since the merge base — worktree only, never the index (both halves of
#      that sentence are load-bearing; see the two sections below)
#   3. COMMIT THE MERGE FIRST, then assert the hand-off tree is committed
#   4. regenerate the whole chain, then run the generated-artifact gates and
#      assert every sibling PR's entries — and the previous PR's IMPLEMENTATION
#      BODY — still exist (quoted-exact-name git grep against origin/main).
#
# This script performs steps 1–3 and prints step 4 (the regen chain varies by
# what the branch touches; running it blind would hide a red).
#
# ## Step 2 chooses a side PER FILE — an unconditional one reverts committed work
#
# Step 2 used to run `git checkout origin/main -- <path>` for every os-regen
# path unconditionally, and that is wrong for any branch whose own change IS a
# hand-edit inside a generated artifact — a retirement branch, above all, whose
# deletions of released baseline lines are the deliverable. Measured twice on
# one retirement branch, on two consecutive sync rounds: a committed
# hand-deletion of a manifest key and of the released authorable-surface /
# authorable-defaults lines came back from main's side, and step 3 then
# COMMITTED the revert. Root cause was established rather than assumed — main
# had changed none of the shards in the merge window (empty per-file diffs), so
# the reintroduction was purely this step. The published-schema and
# authorable-key deletion gates then refused the build ("N previously published
# schema(s) disappeared…"), which is those gates working as hand-deletion
# validators — but it reads as a scary red on the branch that is *supposed* to
# delete them, and it invites exactly the wrong repair: re-adding the keys.
#
# The side is therefore chosen PER FILE, against the merge base captured BEFORE
# the merge, and the two cases are OPPOSITES:
#
#   the branch changed it and MAIN DID NOT — git already resolved that path
#   trivially to the branch's bytes; there was nothing to reconcile, so taking
#   main's side is a pure revert with no merge content behind it. This is the
#   measured incident. ⇒ KEEP the branch's bytes, print a per-path notice.
#
#   BOTH sides changed it — the merge driver ran, exited 0 and silently kept one
#   side. This is the ONLY case where step 2 has any work to do, and doing it is
#   the whole reason the step exists: main's dropped side is restored, and step
#   4's regeneration re-derives the branch's generated content on a known-good
#   base. ⇒ TAKE main's side, and print the loud per-path notice — if the
#   branch's edit here was a HAND edit (a released-baseline deletion no
#   regeneration reproduces), restore those bytes before regenerating.
#
# ⚠️ That split is measured, because the simpler rule — skip EVERY path the
# branch edited — looks right and is not: it makes step 2 INERT. Git invokes a
# merge driver only where both sides changed a path, so every path step 2 can
# act on is by construction a path the branch edited. Skip them all and step 2
# takes nothing, step 3 has nothing to commit, and the driver's silent drop
# rides into the merge commit unrepaired — trading the revert hazard for the
# silent-drop hazard this whole script exists to close. Fixture: one regen path
# edited on both sides with the driver keeping ours, one edited on the branch
# only; the blanket-skip rule leaves the first still dropped.
#
# ⚠️ Per FILE, not per pattern — the hot patterns are directory globs over dozens
# of shards, and a per-pattern decision would let one hand-edited shard govern
# the whole directory.
#
# ⚠️ The base must be read BEFORE step 1. After the merge, HEAD contains
# origin/main, so `git merge-base HEAD origin/main` is origin/main's own tip and
# every file reads as "the branch edited it".
#
# ## Step 2 writes the WORKTREE, never the INDEX — and step 4 reads the index
#
# `git checkout <ref> -- <path>` writes the index as well as the tree. That is
# the second measured hazard: with main's side STAGED by step 2 and the
# regeneration landing in the working tree only, the path sits in `MM`, and a
# bare `git commit` builds from the INDEX — it lands main's side, silently
# reverting the branch in a commit whose message claims the opposite. Two sync
# rounds caught it only by staging the regenerated files explicitly and reading
# the staged diff. `git restore --source=<ref> -- <path>` writes the tree only,
# leaving a lone unstaged `M`, where a bare `git commit` lands NOTHING instead
# of the wrong side — a loud no-op beats a quiet revert.
#
# ⛔ THE RUNBOOK SENTENCE, for step 4 and for anyone doing this by hand:
# **inspect the STAGED diff, not the working-tree diff, before committing**
# (`git add <paths>` then `git diff --cached`). `git diff` and `git diff HEAD`
# never consult the index, so both read clean over exactly this trap.
#
# Step 3 closes the sequence with a hand-off assertion: every os-regen path must
# be COMMITTED before step 4 begins. `MM` is the state the card names, and it is
# the superset — any uncommitted regen path at hand-off means step 4's "commit
# the regeneration as its own commit" would absorb something nobody read.
#
# ## Step 3 and the pre-commit hook agree (#8047)
#
# They used to contradict each other: this script deliberately produces the
# commit the `os-regen` pre-commit hook refused, so following the procedure
# meant skipping the hook — and `--no-verify` skips EVERY pre-commit check, not
# just this one. Ruled 2026-08-12: the hook moved. It now recognises a merge
# commit whose artifacts are stale and records a DEFERRAL rather than refusing,
# then holds you to it — every commit after the merge is refused until the
# regeneration lands, a second merge cannot defer on top of an outstanding one,
# and `.githooks/pre-push` refuses a push that still owes one. So step 3 needs
# no bypass, and step 4 is what clears the marker.
#
# The os-regen path list is read from .gitattributes AT RUN TIME — the one copy
# that cannot rot is the one that does not exist.

set -euo pipefail

# Absolute, because `--self-test` runs this script from inside fixture repos it
# `cd`s into — a relative `$0` resolves to nothing there.
SELF="${BASH_SOURCE[0]}"
case "$SELF" in
  /*) ;;
  *) SELF="$(pwd)/$SELF" ;;
esac

usage() {
  cat <<'EOF'
usage:
  os-regen-merge.sh              run the merge sequence (steps 1–3, print step 4)
  os-regen-merge.sh --self-test  verify this script against synthetic fixtures
  os-regen-merge.sh --help       this text

Run INSIDE the feature branch's worktree, on a clean tree.
EOF
}

# --- the sequence ------------------------------------------------------------

mode_run() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "✗ not inside a git worktree" >&2
    exit 1
  fi

  branch="$(git rev-parse --abbrev-ref HEAD)"
  case "$branch" in
    main | HEAD)
      echo "✗ refusing to run on '$branch' — run inside the feature branch's worktree" >&2
      exit 1
      ;;
  esac

  if [ -n "$(git status --porcelain)" ]; then
    echo "✗ working tree not clean — commit or drop local changes first (⛔ never git stash)" >&2
    exit 1
  fi

  echo "→ fetching origin/main"
  git fetch origin main

  # Captured BEFORE step 1, on purpose — see the header. After the merge both
  # readings answer a different question, and both answer it plausibly.
  branch_tip="$(git rev-parse HEAD)"
  if ! merge_base="$(git merge-base HEAD origin/main)"; then
    echo "✗ no merge base with origin/main — refusing to guess which side is yours" >&2
    exit 1
  fi
  echo "→ branch tip $(git rev-parse --short "$branch_tip") · merge base $(git rev-parse --short "$merge_base")"

  # The single authoritative list, read at run time.
  #
  # READ LOOP, NOT `mapfile` — THE BASH 3.2 FLOOR. `mapfile`/`readarray` are bash
  # 4 builtins and `/usr/bin/env bash` is bash 3.2.57 on macOS (Apple ships no
  # bash 4+, for licensing reasons). This script is run BY HAND, in an agent's or
  # a maintainer's worktree, and it has no CI path at all — nothing in
  # `.github/workflows/` invokes it — so a bash-4 builtin here does not fail on a
  # fringe host, it fails on the ordinary one, and no CI run can ever say so.
  # Measured with the builtin disabled (`enable -n mapfile readarray` via
  # `BASH_ENV`, which reproduces the macOS symptom byte for byte):
  # `mapfile: command not found`, then `set -e` kills the run at status 127 —
  # AFTER `git fetch origin main` and BEFORE step 1, i.e. with the merge sequence
  # whose ORDER is this script's entire reason for existing not begun. The
  # operator is left to perform steps 1–3 by hand, which is the trap the script
  # was written to remove.
  #
  # Keep this loop bash-3.2-clean: no `mapfile`, no `readarray`, no `declare -A`,
  # no `${x^^}`/`${x,,}`. Two details are load-bearing and neither is obvious:
  #
  #   `regen_paths=()` BEFORE the loop. Under `set -u` a loop that appends
  #   nothing never creates the array at all, so `${#regen_paths[@]}` below
  #   aborts with `unbound variable` — and "grep matched nothing" is precisely
  #   the case the refusal below exists to REPORT. Measured: without the
  #   declaration the empty input dies at `regen_paths: unbound variable`; with
  #   it, `count=0` and the refusal prints.
  #
  #   `if [[ -n … ]]; then …; fi`, not a trailing `[[ -n … ]] && …`. Measured:
  #   with the `&&` form the `while` takes status 1 whenever the LAST line read
  #   fails the test, and under `set -e` that kills the caller the moment such a
  #   loop is the last command of a function — silently correct today, a landmine
  #   for the next refactor. The `if` form returns 0 on the same input. (This is
  #   the form #12142 standardised; its own note attributes the trap to the empty
  #   list, which measures clean — an all-empty read leaves the body unexecuted
  #   and the `while` at status 0.)
  regen_paths=()
  regen_line=''
  while IFS= read -r regen_line; do
    if [[ -n "$regen_line" ]]; then regen_paths+=("$regen_line"); fi
  done < <(grep 'merge=os-regen' .gitattributes | awk '{print $1}')
  if [ "${#regen_paths[@]}" -eq 0 ]; then
    echo "✗ no merge=os-regen entries found in .gitattributes — refusing to guess" >&2
    exit 1
  fi
  echo "→ os-regen paths (from .gitattributes, ${#regen_paths[@]} patterns):"
  printf '    %s\n' "${regen_paths[@]}"

  # Which side moved which generated file, read against the pre-merge tip. Two
  # `git diff`s for the whole set — a per-file loop over the hot directory globs
  # would spawn a process per shard. Kept as newline-delimited STRINGS with a
  # leading and trailing newline, so membership is a `case` glob and costs no
  # process at all; a path can never contain a newline (git quotes those).
  NL='
'
  branch_edited=()
  edited_line=''
  while IFS= read -r edited_line; do
    if [[ -n "$edited_line" ]]; then branch_edited+=("$edited_line"); fi
  done < <(git diff --name-only "$merge_base" "$branch_tip" -- "${regen_paths[@]}")
  main_edited="$NL$(git diff --name-only "$merge_base" origin/main -- "${regen_paths[@]}")$NL"

  echo "→ step 1: git merge origin/main"
  if ! git merge --no-edit origin/main; then
    echo "✗ merge stopped on conflicts in NON-generated files — resolve those by hand" >&2
    echo "  (semantic merge, both intents stack), then rerun this script to redo the" >&2
    echo "  generated-artifact half. ⛔ Do not resolve generated files textually." >&2
    exit 1
  fi

  echo "→ step 2: taking origin/main's side of the generated artifacts main moved"
  # ⚠️ bash 3.2 expands `"${arr[@]}"` of an EMPTY array as an unbound variable
  # under `set -u` (fixed only in 4.4), and "the branch edited no generated
  # artifact" is the ordinary case. `${arr[@]+"${arr[@]}"}` is the 3.2-safe
  # spelling: it expands to nothing at all when the array is empty.
  excludes=()
  if [ "${#branch_edited[@]}" -gt 0 ]; then
    for edited in "${branch_edited[@]}"; do
      case "$main_edited" in
        *"$NL$edited$NL"*)
          # Both sides moved it: the driver ran and dropped one side. Taking
          # main's side is the point of this step — but say so per path, loudly.
          echo "   ⚠ TAKING main's side of $edited (both sides changed it)"
          echo "     — the os-regen driver merged it with exit 0 and silently kept one side."
          echo "       Step 4's regeneration re-derives the generated content on top. If this"
          echo "       branch HAND-edited this file (a released-baseline deletion no generator"
          echo "       reproduces), restore the branch bytes before regenerating."
          ;;
        *)
          excludes+=(":(exclude)$edited")
          echo "   ⚠ KEEPING the branch's bytes of $edited"
          echo "     — the branch changed it and main did not, so git resolved it trivially"
          echo "       and there is nothing to reconcile. Taking main's side here would be a"
          echo "       pure revert of a COMMITTED change (a retirement branch's hand-deletions"
          echo "       are the deliverable). Step 4 regenerates it as usual."
          ;;
      esac
    done
  fi
  for p in "${regen_paths[@]}"; do
    # a pattern may match nothing on this branch — that is fine
    git restore --source=origin/main -- "$p" ${excludes[@]+"${excludes[@]}"} 2>/dev/null || true
  done

  echo "→ step 3: committing the merge BEFORE any regeneration"
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    if ! git commit --no-edit -m "merge origin/main (os-regen artifacts taken from main; regeneration follows)"; then
      echo "✗ step 3's commit was refused — the merge is staged but NOT committed." >&2
      echo "  ⛔ Do not regenerate yet: with a staged index a bare \`git commit\` after" >&2
      echo "     regeneration lands the STAGED side, not the tree you inspected." >&2
      echo "  Clear what the hook reported, then \`git add -A && git commit\` before step 4." >&2
      exit 1
    fi
  else
    echo "   (merge left no additional changes to commit)"
  fi

  # Hand-off assertion: step 4 regenerates on top of this tree and commits the
  # result, so anything uncommitted here rides into that commit unread.
  handoff="$(git status --porcelain -- "${regen_paths[@]}")"
  if [ -n "$handoff" ]; then
    echo "✗ refusing to hand off to step 4 — generated paths are not committed:" >&2
    printf '%s\n' "$handoff" >&2
    echo "  A regen path whose INDEX and WORKTREE disagree (porcelain \`MM\`) is the trap:" >&2
    echo "  \`git commit\` builds from the INDEX, so it lands the side you did not inspect —" >&2
    echo "  a commit whose message claims the opposite of its contents. Commit or discard" >&2
    echo "  these first; ⛔ \`git diff\` and \`git diff HEAD\` read clean right over it." >&2
    exit 1
  fi

  cat <<'EOF'
→ step 4 (yours, in this order — the script stops here on purpose):
   1. build the spec build closure, then regenerate the WHOLE chain
      (e.g. pnpm --filter @objectstack/spec build && the gen:* scripts your
      surface touches);
   2. run the generated-artifact gates until fully green;
   3. assert every sibling PR's entries AND the previous PR's implementation
      body still exist: quoted-exact-name `git grep "<symbol>" origin/main -- <path>`
      — entries are the index, the implementation body is what gets swallowed;
   4. `git add` the regenerated paths and INSPECT THE STAGED DIFF, NOT THE
      WORKING-TREE DIFF, BEFORE COMMITTING (`git diff --cached`) — a commit is
      built from the index, and `git diff`/`git diff HEAD` never read it;
   5. commit the regeneration as its own commit and push.
EOF
}

# --- self-test ---------------------------------------------------------------
#
# Fixtures are whole synthetic repos, because every behaviour here is a claim
# about what git does to an index and a worktree — a mock of git would pin the
# mock. Each case builds a bare origin plus a clone, so `origin/main` is a real
# remote-tracking ref and `git fetch origin main` is a real fetch.

st_fail=0

st_case() {
  # st_case <label> <got> <want>
  if [ "$2" = "$3" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n        got:  %s\n        want: %s\n' "$1" "$2" "$3"
    st_fail=$((st_fail + 1))
  fi
}

# Build a fixture repo in $1 and leave the cwd in its clone, on branch
# `feature`. One fixture exercises all three per-file cases at once:
#
#   gen/baseline.txt  branch only  — a COMMITTED hand-deletion, main untouched
#   gen/both.txt      both sides   — the driver runs and silently keeps ours
#   gen/mainonly.txt  main only    — git resolves it to main trivially
#
# The `os-regen` driver is registered as `true`, which is the real driver's
# measured shape for this purpose: exit 0, keep ours, say nothing. Without it
# git never invokes a driver at all and the both-sides case cannot exist.
st_fixture() {
  fx="$1"
  rm -rf "$fx"
  mkdir -p "$fx"
  git init -q --bare -b main "$fx/origin.git"
  git clone -q "$fx/origin.git" "$fx/work" 2>/dev/null
  cd "$fx/work"
  git config user.email selftest@example.invalid
  git config user.name os-regen-merge-selftest
  git config commit.gpgsign false
  git config merge.os-regen.name 'os-regen (fixture: exit 0, silently keeps ours)'
  git config merge.os-regen.driver true

  mkdir -p gen src
  printf 'gen/**   merge=os-regen\n' > .gitattributes
  printf 'ManifestConfig\nPreviewModeConfig\nRuntimeConfig\n' > gen/baseline.txt
  printf 'both v0\n' > gen/both.txt
  printf 'mainonly v0\n' > gen/mainonly.txt
  printf 'source v1\n' > src/app.txt
  git add -A
  git commit -qm seed
  git push -q origin main

  git checkout -q -b feature
  printf 'ManifestConfig\nRuntimeConfig\n' > gen/baseline.txt   # the hand-deletion
  printf 'both v1-BRANCH\n' > gen/both.txt
  printf 'source v2 (branch)\n' > src/app.txt
  git add -A
  git commit -qm 'retire PreviewModeConfig: hand-delete the released baseline line'

  git worktree add -q "$fx/mainwt" main
  (
    cd "$fx/mainwt"
    git config user.email selftest@example.invalid
    git config user.name os-regen-merge-selftest
    git config commit.gpgsign false
    printf 'unrelated main change\n' > src/other.txt
    printf 'both v1-MAIN\n' > gen/both.txt
    printf 'mainonly v1-MAIN\n' > gen/mainonly.txt
    git add -A
    git commit -qm 'main: unrelated change plus two regenerations'
    git push -q origin main
  )
  cd "$fx/work"
  # Released so a case can `git checkout main` in the clone — a checked-out
  # branch cannot be checked out twice.
  git worktree remove "$fx/mainwt"
  git fetch -q origin main
}

mode_self_test() {
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/os-regen-merge-selftest.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT INT TERM
  here="$(pwd)"
  printf 'os-regen-merge --self-test\n'

  # --- 1. all three per-file cases, in one run
  st_fixture "$tmp/a" >/dev/null 2>&1
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'a clean run exits 0' "$rc" 0
  # branch-only: the committed hand-deletion survives — HAZARD 1
  st_case 'branch-only regen path keeps the branch bytes' \
    "$(grep -c 'PreviewModeConfig' gen/baseline.txt || true)" 0
  st_case 'and is not reverted in the commit either' \
    "$(git show HEAD:gen/baseline.txt | grep -c 'PreviewModeConfig' || true)" 0
  st_case 'and the run names it as kept' \
    "$(printf '%s' "$out" | grep -c 'KEEPING the branch.s bytes of gen/baseline.txt' || true)" 1
  # both sides: the driver dropped main's side; step 2 must put it back
  st_case 'both-sides regen path takes main s side' \
    "$(grep -c 'both v1-MAIN' gen/both.txt || true)" 1
  st_case 'and the run names it as taken, loudly' \
    "$(printf '%s' "$out" | grep -c "TAKING main.s side of gen/both.txt" || true)" 1
  st_case 'and that repair is what step 3 commits' \
    "$(git show HEAD:gen/both.txt | grep -c 'both v1-MAIN' || true)" 1
  # main-only: git already resolved it; nothing to say and nothing to do
  st_case 'main-only regen path holds main s side' \
    "$(grep -c 'mainonly v1-MAIN' gen/mainonly.txt || true)" 1
  st_case 'and draws no per-path notice at all' \
    "$(printf '%s' "$out" | grep -cE '(KEEPING|TAKING).*gen/mainonly[.]txt' || true)" 0
  st_case 'step 4 carries the staged-diff sentence' \
    "$(printf '%s' "$out" | grep -c 'INSPECT THE STAGED DIFF' || true)" 1
  st_case 'the hand-off leaves no uncommitted regen path' \
    "$(git status --porcelain -- 'gen/**' | wc -l | tr -d ' ')" 0
  cd "$here"

  # --- 2. step 2 writes the WORKTREE, never the INDEX.
  #
  # ⚠️ This one is pinned at the SOURCE, deliberately. The property is about the
  # state between step 2 and step 3, and step 3's `git add -A` stages the same
  # bytes a moment later either way — so no assertion on a COMPLETED run can
  # tell `git restore --source` from `git checkout <ref> --`. What the spelling
  # buys is the abort path (a refused hook, a Ctrl-C, the sequence resumed by
  # hand): main's side never sits in the index alone, so a bare `git commit`
  # there lands nothing instead of the wrong side. A behavioural pin that cannot
  # fail would be worse than no pin, so the scan says what it really checks.
  # Comment lines are excluded: the header quotes the banned spelling to explain
  # it, and a scan that cannot tell prose from code would red on its own docs.
  st_case 'step 2 uses the non-staging spelling' \
    "$(sed -n '1,/^# --- self-test/p' "$SELF" | grep -v '^[[:space:]]*#' \
       | grep -c 'git restore --source=origin/main' || true)" 1
  st_case 'and never the staging one' \
    "$(sed -n '1,/^# --- self-test/p' "$SELF" | grep -v '^[[:space:]]*#' \
       | grep -c 'git checkout origin/main --' || true)" 0

  # Behaviour that IS observable: after a run, a regeneration on top is a lone
  # unstaged `M` — the state where a bare `git commit` commits nothing at all.
  st_fixture "$tmp/b" >/dev/null 2>&1
  bash "$SELF" >/dev/null 2>&1 || true
  printf 'ManifestConfig\nRuntimeConfig\nregenerated\n' > gen/baseline.txt
  st_case 'a regeneration on top of the run is unstaged M, never MM' \
    "$(git status --porcelain -- gen/baseline.txt | cut -c1-2)" ' M'
  cd "$here"

  # --- 3. the hand-off assertion REFUSES an uncommitted regen path.
  #        Reached through a pre-commit hook that rewrites the worktree after
  #        the index is built — the ordinary formatter shape.
  st_fixture "$tmp/c" >/dev/null 2>&1
  printf '#!/bin/sh\nprintf "hook rewrote this\\n" >> gen/untouched.txt\nexit 0\n' \
    > .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'an uncommitted regen path at hand-off is refused' "$rc" 1
  st_case 'and the refusal names the index/worktree split' \
    "$(printf '%s' "$out" | grep -c 'INDEX and WORKTREE disagree' || true)" 1
  cd "$here"

  # --- 4. a refused step-3 commit exits non-zero and names the staged index
  st_fixture "$tmp/d" >/dev/null 2>&1
  printf '#!/bin/sh\nexit 1\n' > .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'a refused step-3 commit fails the run' "$rc" 1
  st_case 'and warns against regenerating over a staged index' \
    "$(printf '%s' "$out" | grep -c 'Do not regenerate yet' || true)" 1
  cd "$here"

  # --- 5. the pre-existing refusals still hold
  st_fixture "$tmp/e" >/dev/null 2>&1
  printf 'dirt\n' > src/app.txt
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'a dirty tree is refused' "$rc" 1
  st_case 'and says so' \
    "$(printf '%s' "$out" | grep -c 'working tree not clean' || true)" 1
  git checkout -q -- src/app.txt
  git checkout -q main
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'running on main is refused' "$rc" 1
  git checkout -q feature
  printf 'nothing routed here\n' > .gitattributes
  git add -A && git commit -qm 'drop the os-regen routes'
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'an empty os-regen path list is refused' "$rc" 1
  st_case 'and refuses to guess' \
    "$(printf '%s' "$out" | grep -c 'refusing to guess' || true)" 1
  cd "$here"

  if [ "$st_fail" -ne 0 ]; then
    printf '✗ os-regen-merge self-test: %d case(s) failed.\n' "$st_fail"
    return 1
  fi
  printf '✓ os-regen-merge self-test: all cases pass.\n'
  return 0
}

# --- dispatch ----------------------------------------------------------------

main() {
  case "${1:-}" in
    --self-test)
      mode_self_test
      exit $?
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    '')
      mode_run
      ;;
    *)
      echo "✗ unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
