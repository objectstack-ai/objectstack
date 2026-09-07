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
#   4. Reads the path from the key the ROUTED TOOL actually carries — a per-tool table,
#      not one hard-coded key — and blocks rather than guessing when a routed tool's
#      payload does not carry it. A guard that learns nothing from the payload and falls
#      back to judging the session's directory returns a verdict that is constant per
#      session and wrong in BOTH directions, decided by where the session happens to be
#      rooted rather than by anything about the edit.
#
# Deliberate exception (a human quick-fix that still lands via PR): OS_ALLOW_MAIN_EDITS=1.

set -uo pipefail

[ "${OS_ALLOW_MAIN_EDITS:-}" = "1" ] && exit 0

input="$(cat 2>/dev/null || true)"

# WHICH tools reach this guard is the matcher's job, in .claude/settings.json; which KEY
# each of them carries its path in is this table's. The two are one pair, and the pairing
# is checked rather than assumed: a tool routed here with no row below would be read for a
# key its payload never carries, so the guard would learn nothing and judge the session
# instead of the file. The self-test's wiring section reads the line below and reds when
# the matcher routes a tool that has no row in it. Add the tool AND its row together.
known_path_keys='Edit=file_path Write=file_path MultiEdit=file_path NotebookEdit=notebook_path'

have_jq=0; command -v jq >/dev/null 2>&1 && have_jq=1

scan() { # scan <key-alternation> -> first "key": "value" a plain text scan finds, no jq.
  # JSON escapes the quotes of any key name quoted inside a string value, so a payload that
  # merely TALKS about one of these keys cannot outrank the real one.
  printf '%s' "$input" | grep -oE "\"($1)\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 |
    sed 's/^.*"\([^"]*\)"$/\1/' || true
}

tool=""
[ "$have_jq" = 1 ] && tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)"
[ -n "$tool" ] || tool="$(scan 'tool_name')"

key=""
for row in $known_path_keys; do
  case "$row" in "$tool="*) key="${row#*=}" ;; esac
done

file=""
if [ -n "$key" ]; then
  # A tool the table names: read exactly the key that tool is contracted to carry.
  [ "$have_jq" = 1 ] && file="$(printf '%s' "$input" | jq -r --arg k "$key" '.tool_input[$k] // empty' 2>/dev/null || true)"
  [ -n "$file" ] || file="$(scan "$key")"
else
  # A tool the table does not name is not routed here by the matcher. Judge it by whichever
  # known key it happens to carry, and fall back to the project dir when it carries none.
  [ "$have_jq" = 1 ] && file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null || true)"
  [ -n "$file" ] || file="$(scan 'file_path|notebook_path')"
fi

# A ROUTED tool that carries no path under its own key is schema drift, not a missing path:
# the contract this guard was written against has moved. Report it instead of guessing.
if [ -n "$key" ] && [ -z "$file" ]; then
  cat >&2 <<EOF
⛔ Blocked: a $tool payload carrying no "$key" — this guard cannot tell which file is being written.

$tool is routed to this guard by .claude/settings.json, and this guard reads that tool's
path from .tool_input.$key. An absent value means the tool's input schema has moved under
the guard. Falling back to the session's directory would make the verdict a constant per
session — right or wrong purely by where the session is rooted, not by the edit — so this
blocks instead.

Fix the row for $tool in this hook's known_path_keys table, then re-run
.claude/hooks/guard-main-checkout.selftest.sh.

Deliberate non-task exception: set OS_ALLOW_MAIN_EDITS=1 in the
environment this hook itself runs in — a local settings "env" entry, or whatever this
agent process was started with. A VAR=1 prefix on a command sets it for that command
only, and this hook is not that command, so a prefix never reaches it.
EOF
  exit 2
fi

# Judge the checkout at the file's nearest existing ancestor dir (handles new files in
# not-yet-created directories). Fall back to the project dir when no file path is given.
if [ -n "$file" ]; then d="$(dirname "$file")"; else d="${CLAUDE_PROJECT_DIR:-$PWD}"; fi
while [ -n "$d" ] && [ "$d" != "/" ] && [ ! -d "$d" ]; do d="$(dirname "$d")"; done
[ -d "$d" ] || d="${CLAUDE_PROJECT_DIR:-$PWD}"

# Canonicalise an existing directory to its physical absolute path, so both sides of the
# comparison below are spelled the same way: git prints the common-dir RELATIVE, and some
# hosts hand out symlinked temp dirs.
canon_dir() { ( cd "$1" 2>/dev/null && pwd -P ) || printf '%s' "$1"; }

# Am I in a LINKED WORKTREE? Structurally: a linked worktree's git-dir (.git/worktrees/NAME)
# differs from its git-COMMON-dir (.git). A primary checkout has the two equal, and so does a
# submodule (.git/modules/NAME for both) — which is why neither needs a special case. The
# test holds whatever the path is spelled like; the `*/worktrees/*` substring match it
# replaces did not, so a PRIMARY checkout that merely lived under a directory named
# `worktrees` read as a linked worktree and went unguarded (#11809). --git-common-dir prints
# RELATIVE to $d (`.git` at a toplevel, `../.git` from a subdirectory), so it MUST be
# resolved against $d first: compared raw it never equals the absolute git-dir, and the
# guard would fail open at EVERY depth instead of some.
gitdir="$(git -C "$d" rev-parse --absolute-git-dir 2>/dev/null)" || exit 0
commondir="$(git -C "$d" rev-parse --git-common-dir 2>/dev/null)" || exit 0
case "$commondir" in /*) ;; *) commondir="$d/$commondir" ;; esac
[ "$(canon_dir "$gitdir")" != "$(canon_dir "$commondir")" ] && exit 0

root="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$d")"
branch="$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null || printf '?')"
name="$(basename "$root")"
# ⭐ The recipe printed below is the HIGHEST-leverage copy of AGENTS.md PD#11's worktree
# recipe: it reaches an agent at the exact moment it is about to create one, so an agent
# following it lands wherever this string points. Keep it aligned with the prescribed form
# there — both halves are adjudicated, and this copy carried NEITHER until #13663:
#   `git fetch origin main` first — an unfetched local `main` bases the new tree on a stale
#     commit (the ui#6208 class).
#   `--no-track` on the add — plain `-b` writes branch.NAME.remote/merge into the .git/config
#     that every worktree of this repo SHARES (the #13052 / ui#6880 class).
cat >&2 <<EOF
⛔ Blocked: editing on the shared PRIMARY checkout, not a worktree.
   repo: $root  (branch: $branch)

This repo is edited by multiple agents at once — the shared checkout gets its HEAD
switched and tree reset under you, silently clobbering uncommitted work. A feature
branch on the shared checkout is NOT enough; you must be in a dedicated worktree:

  git fetch origin main && git worktree add --no-track ../${name}-<task> -b <branch> origin/main
  cd ../${name}-<task> && pnpm install    # then re-run your edits there

This guard checks the edited file's OWN repo, so sibling repos are covered too.

Deliberate non-task exception: set OS_ALLOW_MAIN_EDITS=1 in the
environment this hook itself runs in — a local settings "env" entry, or whatever this
agent process was started with. A VAR=1 prefix on a command sets it for that command
only, and this hook is not that command, so a prefix never reaches it.
EOF
exit 2
