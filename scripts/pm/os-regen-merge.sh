#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# os-regen-merge.sh — the mechanized merge sequence for a branch that touches
# os-regen-driven generated artifacts. Run INSIDE the feature branch's worktree.
#
#   bash scripts/pm/os-regen-merge.sh
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
#   2. git checkout origin/main -- <every os-regen path>   (take main's side)
#   3. COMMIT THE MERGE FIRST
#   4. regenerate the whole chain, then run the generated-artifact gates and
#      assert every sibling PR's entries — and the previous PR's IMPLEMENTATION
#      BODY — still exist (quoted-exact-name git grep against origin/main).
#
# This script performs steps 1–3 and prints step 4 (the regen chain varies by
# what the branch touches; running it blind would hide a red). Sister trap for
# step 4: `gen:schema`'s cleanup wipes `gen:openapi`'s output, which shows up as
# bogus 5xx assertions in the rest package — rerun
# `pnpm --filter @objectstack/spec gen:openapi` to restore.
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

# The single authoritative list, read at run time.
mapfile -t regen_paths < <(grep 'merge=os-regen' .gitattributes | awk '{print $1}')
if [ "${#regen_paths[@]}" -eq 0 ]; then
  echo "✗ no merge=os-regen entries found in .gitattributes — refusing to guess" >&2
  exit 1
fi
echo "→ os-regen paths (from .gitattributes, ${#regen_paths[@]} patterns):"
printf '    %s\n' "${regen_paths[@]}"

echo "→ step 1: git merge origin/main"
if ! git merge --no-edit origin/main; then
  echo "✗ merge stopped on conflicts in NON-generated files — resolve those by hand" >&2
  echo "  (semantic merge, both intents stack), then rerun this script to redo the" >&2
  echo "  generated-artifact half. ⛔ Do not resolve generated files textually." >&2
  exit 1
fi

echo "→ step 2: taking origin/main's side of every generated artifact"
for p in "${regen_paths[@]}"; do
  # a pattern may match nothing on this branch — that is fine
  git checkout origin/main -- "$p" 2>/dev/null || true
done

echo "→ step 3: committing the merge BEFORE any regeneration"
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit --no-edit -m "merge origin/main (os-regen artifacts taken from main; regeneration follows)"
else
  echo "   (merge left no additional changes to commit)"
fi

cat <<'EOF'
→ step 4 (yours, in this order — the script stops here on purpose):
   1. build the spec build closure, then regenerate the WHOLE chain
      (e.g. pnpm --filter @objectstack/spec build && the gen:* scripts your
      surface touches; gen:schema's cleanup wipes gen:openapi's output — rerun
      pnpm --filter @objectstack/spec gen:openapi after it);
   2. run the generated-artifact gates until fully green;
   3. assert every sibling PR's entries AND the previous PR's implementation
      body still exist: quoted-exact-name `git grep "<symbol>" origin/main -- <path>`
      — entries are the index, the implementation body is what gets swallowed;
   4. commit the regeneration as its own commit and push.
EOF
