#!/usr/bin/env bash
# guard-main-checkout.sh — PreToolUse guard enforcing AGENTS.md worktree-first rule.
# Blocks Edit / Write / NotebookEdit unless the file being edited lives in a dedicated
# git WORKTREE — not the shared primary checkout.
#
# Why: this repo (and its sibling repos) are edited by MULTIPLE agents at once. The
# shared primary checkout has its HEAD switched and its tree reset *under you*, silently
# clobbering uncommitted work. A feature branch on the shared checkout is NOT enough —
# it still gets switched under you. Only a dedicated per-task worktree is isolated.
#
# Hardened over the original guard (holes agents fell through):
#   1. Checks "am I in a linked worktree?" — not merely "branch != default". A feature
#      branch on the shared checkout no longer passes.
#   2. Checks the EDITED FILE's repo — not just $CLAUDE_PROJECT_DIR — so sibling repos
#      edited from this session are guarded too.
#   3. Resolves the file's nearest EXISTING ancestor dir, so creating a new file in a
#      new directory can't fail-open past the guard.
#
# Deliberate exception (a human quick-fix that still lands via PR): OS_ALLOW_MAIN_EDITS=1.

set -uo pipefail

[ "${OS_ALLOW_MAIN_EDITS:-}" = "1" ] && exit 0

input="$(cat 2>/dev/null || true)"
file=""
if command -v jq >/dev/null 2>&1; then
  file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
fi
if [ -z "$file" ]; then
  file="$(printf '%s' "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^.*"\([^"]*\)"$/\1/' || true)"
fi

# Judge the checkout at the file's nearest existing ancestor dir (handles new files in
# not-yet-created directories). Fall back to the project dir when no file path is given.
if [ -n "$file" ]; then d="$(dirname "$file")"; else d="${CLAUDE_PROJECT_DIR:-$PWD}"; fi
while [ -n "$d" ] && [ "$d" != "/" ] && [ ! -d "$d" ]; do d="$(dirname "$d")"; done
[ -d "$d" ] || d="${CLAUDE_PROJECT_DIR:-$PWD}"

gitdir="$(git -C "$d" rev-parse --git-dir 2>/dev/null)" || exit 0

case "$gitdir" in
  */worktrees/*) exit 0 ;;
esac

root="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$d")"
branch="$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null || printf '?')"
name="$(basename "$root")"
cat >&2 <<EOF
⛔ Blocked: editing on the shared PRIMARY checkout, not a worktree.
   repo: $root  (branch: $branch)

This repo is edited by multiple agents at once — the shared checkout gets its HEAD
switched and tree reset under you, silently clobbering uncommitted work. A feature
branch on the shared checkout is NOT enough; you must be in a dedicated worktree:

  git worktree add ../${name}-<task> -b <branch> main
  cd ../${name}-<task> && pnpm install    # then re-run your edits there

This guard checks the edited file's OWN repo, so sibling repos are covered too.

Deliberate non-task exception: re-run with OS_ALLOW_MAIN_EDITS=1.
EOF
exit 2
