#!/usr/bin/env bash
# guard-shared-stash.sh — PreToolUse guard: the stash stack is SHARED across worktrees.
# Blocks Bash commands that push to / pop from / drop the shared stash stack, and lets
# the read-only and SHA-pinned forms through.
#
# Why: `git stash` keeps its stack in refs/stash inside the COMMON .git directory. Every
# linked worktree shares that one LIFO stack, so the per-task worktree isolation AGENTS.md
# Prime Directive #11 mandates — and guard-main-checkout.sh enforces — does NOT extend to
# stash. Two agents stashing in their own worktrees operate on the same stack: A's pop
# restores whatever B pushed a moment earlier, and A's own changes stay on the stack for
# B to take.
#
# Live incident, objectui#3430 (2026-08-06, ~03:56Z): a reverse-verification
# `git stash push -- packages/fields/.../RecordPickerDialog.tsx` followed by
# `git stash pop` dropped b52e3aa instead — another agent's WIP on claude/issue-5733-…,
# two unrelated plugin-detail files. Both agents' in-flight work swapped places; a
# `git add -A` on either side would have merged the other's changes into the wrong PR.
# The failure mode is maximally confusing: pop reports SUCCESS, and someone else's files
# simply appear in your git status. Recovery worked only because the dropped SHA was still
# in scrollback — once the stack empties, refs/stash and logs/refs/stash are both gone and
# `git reflog refs/stash` answers `fatal: ambiguous argument`; a `git gc` in between makes
# the loss permanent. Reverse verification is routine here and stash is the handiest tool
# for it, so the collision probability is not small.
#
# Ported from objectui's hook of the same name (objectui#3430 / objectui PR #3433), filed
# for this repo as objectstack#5742. The verdict logic below is deliberately kept
# case-for-case identical to objectui's so the two repos' guards cannot drift; only issue
# references, example paths and the package name in the self-test are localised — the same
# mirroring discipline guard-main-checkout-bash.sh already documents.
#
# Alternatives — no shared state, all of these work inside your own worktree:
#   1. clean re-read     git checkout origin/main -- <path>   (restore: git checkout <branch> -- <path>)
#   2. patch file        git diff > /tmp/wip.patch && git checkout -- <paths>
#                        git apply /tmp/wip.patch          (git apply -R to undo again)
#   3. temporary commit  git commit -am wip                (git reset --soft HEAD~1)
#   4. a second worktree for the comparison checkout
#
# Allowed through, deliberately:
#   - `git stash list` / `git stash show`  — read-only, they never mutate the stack.
#   - `git stash create`  — writes a commit object and prints its object id WITHOUT
#     storing it in the ref namespace (git-stash(1)); the safe primitive underneath the
#     SHA-pinned workflow.
#   - `git stash apply <sha>` / `git stash store <sha>` — the recovery path used to repair
#     the incident above. An explicit hex object id ONLY: stash@{0} is a POSITION in the
#     shared stack and may be another agent's entry by the time your command runs.
#
# Deliberate exception (you know the stack is yours alone): OS_ALLOW_STASH=1.
#
# Exit-code contract, mirroring guard-main-checkout.sh: 0 = allow, 2 = block with the
# reason on stderr. Anything this cannot parse fails OPEN — a guard that blocks work it
# does not understand gets disabled, and then it guards nothing.
#
# Known boundary, stated so nobody has to rediscover it: the check reads the FIRST WORD of
# each shell segment, so a wrapped invocation (bash -c '…', xargs, ssh host '…') is not
# caught. That is the deliberate trade — the target is the reflexive `git stash push` an
# agent reaches for mid-task, not a determined evader, and OS_ALLOW_STASH=1 already exists
# for anyone who means it. Widening it to string-match anywhere in the command would block
# every `grep "git stash"` run against this very file.
#
# Self-test (32 cases, no network, no build): .claude/hooks/guard-shared-stash.selftest.sh

set -uo pipefail

[ "${OS_ALLOW_STASH:-}" = "1" ] && exit 0

input="$(cat 2>/dev/null || true)"
cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
fi
if [ -z "$cmd" ]; then
  # jq-less fallback: lift the JSON string value honouring backslash escapes (so an
  # embedded \" does not truncate the command), then unescape what matters for shell text.
  cmd="$(printf '%s' "$input" \
    | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(\(\\.\|[^"\\]\)*\)".*/\1/p' \
    | head -1 \
    | sed 's/\\n/ /g; s/\\t/ /g; s/\\"/"/g; s/\\\\/\\/g')"
fi

[ -n "$cmd" ] || exit 0

# --- split the command into shell segments, honouring quotes ---------------------------
# A separator inside '…' or "…" does NOT split, so writing *about* the ban is never caught
# by the ban: `grep -n "cd x && git stash pop" AGENTS.md` stays one segment whose first
# word is grep. (objectstack#4890's lesson — the PR writing a rule must not trip it.)
segments=()
split_segments() {
  local s="$1" seg="" q="" ch i n=${#1}
  for ((i = 0; i < n; i++)); do
    ch="${s:i:1}"
    if [ -n "$q" ]; then
      seg+="$ch"
      [ "$ch" = "$q" ] && q=""
      continue
    fi
    case "$ch" in
      "'" | '"') q="$ch" ; seg+="$ch" ;;
      ';' | '|' | '&' | '(' | ')' | '{' | '}' | $'\n') segments+=("$seg") ; seg="" ;;
      *) seg+="$ch" ;;
    esac
  done
  segments+=("$seg")
}

# --- verdict for one segment -----------------------------------------------------------
# returns 0 = fine, 1 = this segment mutates the shared stash stack.
check_segment() {
  local seg="$1"
  local -a w=()
  read -r -a w <<<"$seg"
  local i=0 n=${#w[@]}
  [ "$n" -gt 0 ] || return 0

  # leading FOO=bar environment assignments
  while [ "$i" -lt "$n" ]; do
    case "${w[$i]}" in
      [A-Za-z_][A-Za-z0-9_]*=*) i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "$n" ] || return 0

  # /usr/bin/git -> git
  [ "${w[$i]##*/}" = "git" ] || return 0
  i=$((i + 1))

  # git's own global options, before the subcommand
  while [ "$i" -lt "$n" ]; do
    case "${w[$i]}" in
      -C | -c | --exec-path | --git-dir | --work-tree | --namespace) i=$((i + 2)) ;;
      -*) i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "$n" ] || return 0
  [ "${w[$i]}" = "stash" ] || return 0
  i=$((i + 1))

  local sub="${w[$i]:-}"
  case "$sub" in
    --help | -h) return 0 ;;             # reading the manual is not stashing
    list | show) return 0 ;;             # read-only against refs/stash
    create) return 0 ;;                  # makes an object, does NOT store it in the stack
    apply | store)
      # pinned to an explicit hex object id => this cannot pick up another agent's entry.
      local j
      for ((j = i + 1; j < n; j++)); do
        [[ "${w[$j]}" =~ ^[0-9a-fA-F]{7,40}$ ]] && return 0
      done
      ;;
  esac
  return 1
}

split_segments "$cmd"
for seg in "${segments[@]}"; do
  check_segment "$seg" && continue
  offending="${seg#"${seg%%[![:space:]]*}"}"
  cat >&2 <<EOF
⛔ Blocked: git stash uses ONE stack shared by every worktree of this repo.
   command: $offending

refs/stash lives in the COMMON .git directory, so the per-task worktree isolation this
repo mandates (AGENTS.md Prime Directive #11) does NOT cover the stash stack. Another
agent's pop takes YOUR entry and yours takes theirs — pop reports success and their files
show up in your git status, which is why objectui#3430 swapped two agents' in-flight
changes without an error.

Use instead — no shared state, all inside your own worktree:
  1. clean re-read    git checkout origin/main -- <path>
                      git checkout <your-branch> -- <path>   # put your version back
  2. patch file       git diff > /tmp/wip.patch && git checkout -- <paths>
                      git apply /tmp/wip.patch          # git apply -R to undo again
  3. temporary commit git commit -am wip                # git reset --soft HEAD~1
  4. a second worktree for the comparison checkout

Already allowed, no flag needed:
  git stash list | git stash show | git stash create
  git stash apply <sha> | git stash store <sha>    # literal hex id, never stash@{N}

Deliberate exception (the stack really is yours alone): re-run with OS_ALLOW_STASH=1.
EOF
  exit 2
done

exit 0
