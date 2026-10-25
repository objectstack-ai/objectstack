#!/usr/bin/env bash
# copied from objectstack@338297e46018ae96256262590a308c8be735f825
# guard-shared-stash.sh — PreToolUse guard: the stash stack is SHARED across worktrees.
# Blocks Bash commands that push to / pop from / drop the shared stash stack, and lets
# the read-only and SHA-pinned forms through.
#
# Why: `git stash` keeps its stack in refs/stash inside the COMMON .git directory. Every
# linked worktree shares that one LIFO stack, so the per-task worktree isolation AGENTS.md
# mandates — and guard-main-checkout.sh enforces — does NOT extend to stash. Two agents
# stashing in their own worktrees operate on the same stack: A's pop restores whatever B
# pushed a moment earlier, and A's own changes stay on the stack for B to take.
#
# Live incident, objectui#3430 (2026-08-06, ~03:56Z): a reverse-verification
# `git stash push -- packages/fields/.../RecordPickerDialog.tsx` followed by
# `git stash pop` dropped b52e3aa instead — another agent's WIP on claude/issue-5733-…,
# two unrelated plugin-detail files. Both agents' in-flight work swapped places; a
# `git add -A` on either side would have merged the other's changes into the wrong PR.
# The failure mode is maximally confusing: pop reports SUCCESS, and someone else's files
# simply appear in your git status. Reverse verification is routine here and stash is the
# handiest tool for it, so the collision probability is not small.
#
# Alternatives — no shared state, all three work inside your own worktree:
#   1. patch file       git diff > /tmp/wip.patch && git checkout -- <paths>
#                       git apply /tmp/wip.patch          (git apply -R to undo again)
#   2. temporary commit git commit -am wip                (git reset --soft HEAD~1)
#   3. a second worktree for the comparison checkout
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
# Self-test (62 cases, no network, no build): .claude/hooks/guard-shared-stash.selftest.sh
# 62 = 57 `expect ` lines + 2 inline specials (empty-tool_input fail-open, no-jq fallback)
# + 2 hatch-message assertions (`lacks`/`says`, which are not `expect ` lines) + 1 identity
# pin (`same_fn`, the subst_end() copy, which is not an `expect ` line either).
# Re-derive when the matrix changes: `grep -c '^expect ' <selftest>` + 5, and the run's own
# tail prints the total ("N passed, N failed") — keep this number equal to it.

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
#
# OUTSIDE quotes a backslash escapes the NEXT character, so an escaped `\"` opens no quoted
# region at all. Without a branch for it this pass read that `"` as OPENING a region that
# never closed, went inert for every separator behind it, collapsed the whole command into
# one segment whose head word was the harmless one, and waved a real `git stash` through as
# a mere argument of `echo`. That is a fail-OPEN in the backstop for the one rule whose
# breach silently corrupts ANOTHER agent's work (objectstack#11131, the same defect the
# sibling hook guard-main-checkout-bash.sh carried; objectui#6042).
#
# INSIDE "…" the rule inverts: there a backslash is special only before " \ $ ` , and an
# escaped `\"` is a literal quote that leaves the region OPEN. A pass that reads it as
# CLOSING goes outside quotes while bash is still inside, so separators behind it split
# where bash would not: the tail of a pure READ becomes a segment of its own, judged on its
# own head word — a false BLOCK on a command that touches no stash, which is exactly what
# the paragraph at the top of this section promises can never happen. The same gap fails
# OPEN in the other direction: once the escapes pair up the quoted region is left hanging
# and a real `git stash` behind it rides through as a mere argument. Inside '…' nothing is
# special, hence the q='"' gate. This is the in-quote half of the backslash rule, in the
# same shape and with the same escapee list as guard-main-checkout-bash.sh's
# split_segments() carries; that guard's `word` bookkeeping has no analogue here because
# this pass has no comment rule to track word starts for.
#
# INSIDE "…" a `$(`, a backtick or a `${` opens a quoting context of its own, so a `"` in its
# body nests instead of closing the outer string. Without that rule this pass read the inner
# `"` as the closer, the `;` inside the body split, and a pure read became a stash command —
# measured on this repo's copy before the fix: `echo "a $(echo "x; git stash pop")"` and
# `echo "${x:-"a; git stash pop"}"` were BLOCKED (objectstack#24901). The body is kept verbatim inside
# the segment, so a stash inside a QUOTED substitution stays the fail-open it always was.
#
# subst_end() is copied byte-for-byte from guard-main-checkout-bash.sh, whose comment above
# the function is its documentation; this hook's self-test fails when the copy differs.
SUBST_END=0
subst_end() {
  local s="$1" i="$2" n=${#1} st ch top run
  case "${s:i:2}" in
    '$(') st=')' ; i=$((i + 1)) ;;
    '${') st='}' ; i=$((i + 1)) ;;
    '`'*) st='`' ;;
    *) return 1 ;;
  esac
  for ((i = i + 1; i < n; i++)); do
    ch="${s:i:1}" ; top="${st:${#st}-1:1}"
    if [ "$top" = "'" ]; then [ "$ch" = "'" ] && st="${st%?}"; continue; fi
    if [ "$ch" = '\' ]; then i=$((i + 1)); continue; fi
    if [ "$top" = '"' ] || [ "$top" = '}' ]; then
      case "$ch" in
        '"') if [ "$top" = '"' ]; then st="${st%?}"; else st+='"'; fi ;;
        '`') st+='`' ;;
        '$')
          case "${s:i+1:1}" in
            '(') st+=')' ; i=$((i + 1)) ;;
            '{') st+='}' ; i=$((i + 1)) ;;
          esac ;;
        '}') [ "$top" = '}' ] && st="${st%?}" ;;
        "'")
          if [ "$top" = '}' ]; then
            run="${s:i+1}"
            case "$run" in *"'"*) ;; *) SUBST_END=$((n - 1)); return 0 ;; esac
            run="${run%%"'"*}"
            case "$run" in *[\"\\\`\$\}]*) SUBST_END=$((n - 1)); return 0 ;; esac
            i=$((i + ${#run} + 1))
          fi ;;
      esac
      if [ -z "$st" ]; then SUBST_END=$i; return 0; fi
      continue
    fi
    case "$ch" in
      "'" | '"') st+="$ch" ;;
      '(') st+=')' ;;
      ')') [ "$top" = ')' ] && st="${st%?}" ;;
      '`') if [ "$top" = '`' ]; then st="${st%?}"; else st+='`'; fi ;;
    esac
    if [ -z "$st" ]; then SUBST_END=$i; return 0; fi
  done
  SUBST_END=$((n - 1))
  return 0
}

segments=()
split_segments() {
  local s="$1" seg="" q="" ch i n=${#1}
  for ((i = 0; i < n; i++)); do
    ch="${s:i:1}"
    if [ -n "$q" ]; then
      if [ "$q" = '"' ] && [ "$ch" = '\' ] && [ $((i + 1)) -lt "$n" ]; then
        case "${s:i+1:1}" in
          '"' | '\' | '$' | '`')
            seg+="$ch" ; i=$((i + 1)) ; seg+="${s:i:1}" ; continue ;;
        esac
      fi
      if [ "$q" = '"' ] && { [ "$ch" = '$' ] || [ "$ch" = '`' ]; } && subst_end "$s" "$i"; then
        seg+="${s:i:SUBST_END-i+1}" ; i=$SUBST_END ; continue
      fi
      seg+="$ch"
      [ "$ch" = "$q" ] && q=""
      continue
    fi
    case "$ch" in
      '\')
        seg+="$ch"
        if [ $((i + 1)) -lt "$n" ]; then i=$((i + 1)) ; seg+="${s:i:1}" ; fi
        ;;
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
repo mandates does NOT cover the stash stack. Another agent's pop takes YOUR entry and
yours takes theirs — pop reports success and their files show up in your git status,
which is why objectui#3430 swapped two agents' in-flight changes without an error.

Use instead — no shared state, all inside your own worktree:
  1. patch file       git diff > /tmp/wip.patch && git checkout -- <paths>
                      git apply /tmp/wip.patch          # git apply -R to undo again
  2. temporary commit git commit -am wip                # git reset --soft HEAD~1
  3. a second worktree for the comparison checkout

Already allowed, no flag needed:
  git stash list | git stash show | git stash create
  git stash apply <sha> | git stash store <sha>    # literal hex id, never stash@{N}

Deliberate exception (the stack really is yours alone): set OS_ALLOW_STASH=1 in the
environment this hook itself runs in — a local settings "env" entry, or whatever this
agent process was started with. A VAR=1 prefix on a command sets it for that command
only, and this hook is not that command, so a prefix never reaches it.
EOF
  exit 2
done

exit 0
