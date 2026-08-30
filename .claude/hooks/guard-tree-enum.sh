#!/usr/bin/env bash
# guard-tree-enum.sh — PreToolUse guard: the `origin/main` reading rule covers file
# CONTENTS but not file ENUMERATION. Blocks a Bash command that takes its file LIST from
# the working tree and its file CONTENTS from `origin/main`, and lets either half alone —
# and the `git ls-tree origin/main` enumeration — straight through.
#
# Why: this repo's instructions say "核验 main 用 `origin/main`" — read contents with
# `git show origin/main:<path>` or `git grep … origin/main`, never from the shared working
# tree whose HEAD other agents switch under you. That rule is about READS. A sweep can obey
# it perfectly and still be wrong, because the FILE LIST is a second, unruled source:
#
#   for f in .github/workflows/*.yml; do          # ← list from the WORKING TREE
#     git show "origin/main:$f" | grep -q PATTERN # ← contents from origin/main
#   done
#
# Every file it opens is read correctly. Files that exist on `origin/main` but not at the
# working tree's current HEAD are never iterated at all, so the loop cannot report them and
# cannot know it missed them. The output is a zero that looks like a full-tree scan.
#
# Live incident, objectui (2026-08-29), filed as objectstack#13305: a seat ran exactly the
# loop above to decide whether flipping a batch of draft PRs to ready would trigger any CI.
# Measured that day — working tree `ls .github/workflows/*.yml | wc -l` = 30;
# `git ls-tree --name-only origin/main .github/workflows/ | grep -c '\.yml$'` = 31. The one
# missing file was `.github/workflows/governed-surface-guard.yml`, whose line 36 declares
# `types: [opened, synchronize, reopened, ready_for_review]` — that is, the answer to the
# exact question being asked was the file left out of the enumeration. Acting on the wrong
# reading, the seat flipped 10 PRs to ready; each fired a fresh guard run and went from
# `mergeable_state: clean` to `unstable`, during an ongoing runner-capacity outage.
#
# ⚠️ Why the existing zero-hit discipline did not catch it — the transferable part, and the
# reason this is a hook rather than a paragraph. The discipline says a zero is only a
# reading if a control term that MUST hit is run in the same query and does. One was run:
# `pull_request` matched 5 workflow files, so the method demonstrably worked. But those 5
# files came from the SAME faulty list, so the control validated the MATCHER and said
# nothing about the ENUMERATION. Grading of objectstack#13305, verbatim and untranslated:
#
#   「一个对照必须有能力因为你担心的那个原因而失败;同源对照结构上做不到。」
#
# ⇒ when a sweep's POPULATION and its per-item READ come from different sources, the
# control has to be drawn from the population source, not the read source.
#
# The canonical fix, mirroring how `git show origin/main:` is already the canonical way to
# read contents — enumerate from the same ref you read from:
#
#   git ls-tree --name-only origin/main <dir>
#
# A command that enumerates that way is never blocked here, however it then reads.
#
# What is detected, and only when BOTH appear in ONE command — either alone is fine and is
# allowed, because either alone is correct in ordinary use:
#   (a) a WORKING-TREE enumeration — `for NAME in <glob>`, `ls <glob>`, `find <path>`
#   (b) an `origin/…` CONTENT read — `git show origin/…:<path>`, `git grep … origin/…`,
#       `git cat-file … origin/…:<path>`
# Suppressed whenever the same command also runs `git ls-tree … origin/…`: that is the
# recommended population/read cross-check, and it must not be harder to write than the bug.
#
# Deliberate exception (the working tree really is the population you mean — e.g. you are
# asking what YOUR branch changed): OS_ALLOW_TREE_ENUM=1.
#
# Exit-code contract, mirroring guard-shared-stash.sh and guard-main-checkout.sh:
# 0 = allow, 2 = block with the reason on stderr. Anything this cannot parse fails OPEN —
# a guard that blocks work it does not understand gets disabled, and then it guards nothing.
# The rule outranks the hook, not the other way round.
#
# Known boundaries, stated so nobody has to rediscover them:
#   - Classification reads the FIRST WORD of each shell segment, so a wrapped invocation
#     (`bash -c '…'`, `xargs`, `ssh host '…'`) is not caught. Same deliberate trade the
#     stash guard documents: the target is the reflexive sweep an agent writes mid-task,
#     not a determined evader, and OS_ALLOW_TREE_ENUM=1 exists for anyone who means it.
#   - Split across two Bash calls (glob into a variable in one, read it in the next) is out
#     of reach by construction — a PreToolUse hook sees one command at a time.
#   - Writing ABOUT the defect is never caught: `grep -n 'git show origin/main:' AGENTS.md`
#     has head word `grep`, so it is neither (a) nor (b). The PR that writes a rule must not
#     trip the rule it writes.
#
# Self-test (no network, no build): .claude/hooks/guard-tree-enum.selftest.sh

set -uo pipefail

[ "${OS_ALLOW_TREE_ENUM:-}" = "1" ] && exit 0

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
# Kept case-for-case identical to guard-shared-stash.sh's pass, including the #11738
# repair: OUTSIDE quotes a backslash escapes the NEXT character, so an escaped `\"` opens
# no quoted region. Without that branch a stray `\"` makes every separator behind it inert,
# the command collapses into one segment, and the real work rides through as an argument.
#
# `(` and `)` are separators, which is what makes command substitution fall out correctly
# here: `for f in $(git ls-tree --name-only origin/main dir)` becomes `for f in $` — no
# glob, so not an enumeration — plus a `git ls-tree` segment, which is the suppressor.
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

# strip one layer of surrounding quotes so `"origin/main:$f"` reads as origin/main:$f
unquote() {
  local w="$1"
  w="${w#\"}" ; w="${w%\"}"
  w="${w#\'}" ; w="${w%\'}"
  printf '%s' "$w"
}

# a word that the shell would glob-expand against the working tree
is_glob_word() {
  case "$1" in
    *\**| *\?*) return 0 ;;
  esac
  return 1
}

# a word naming a path on a remote-tracking ref, e.g. origin/main:.github/workflows/x.yml
is_remote_pathspec() {
  case "$(unquote "$1")" in
    origin/*:*) return 0 ;;
  esac
  return 1
}

# a bare remote-tracking ref used as a git-grep search root, e.g. origin/main
is_remote_ref() {
  case "$(unquote "$1")" in
    origin/*:*) return 1 ;;
    origin/?*) return 0 ;;
  esac
  return 1
}

saw_working_tree_enum=0
saw_remote_read=0
saw_ls_tree=0
enum_example=""
read_example=""

# --- classify one segment ---------------------------------------------------------------
classify_segment() {
  local seg="$1"
  local -a w=()
  read -r -a w <<<"$seg"
  local i=0 n=${#w[@]}
  [ "$n" -gt 0 ] || return 0

  # leading shell keywords a separator leaves at the head of a segment, plus FOO=bar
  while [ "$i" -lt "$n" ]; do
    case "${w[$i]}" in
      do | then | else | elif | '!' | time | nohup | exec | command | env)
        i=$((i + 1)) ;;
      [A-Za-z_][A-Za-z0-9_]*=*) i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "$n" ] || return 0

  local head="${w[$i]##*/}"
  local j

  # (a) working-tree enumeration ---------------------------------------------------------
  case "$head" in
    for)
      # for NAME in WORD…  — a glob in the `in` list expands against the working tree
      for ((j = i + 1; j < n; j++)); do
        [ "${w[$j]}" = "in" ] || continue
        local k
        for ((k = j + 1; k < n; k++)); do
          if is_glob_word "${w[$k]}"; then
            saw_working_tree_enum=1
            [ -n "$enum_example" ] || enum_example="for ${w[$((i + 1))]} in ${w[$k]}"
            return 0
          fi
        done
        break
      done
      ;;
    ls)
      for ((j = i + 1; j < n; j++)); do
        if is_glob_word "${w[$j]}"; then
          saw_working_tree_enum=1
          [ -n "$enum_example" ] || enum_example="ls ${w[$j]}"
          return 0
        fi
      done
      ;;
    find)
      # find PATH … — enumerates the working tree whether or not a glob is written
      for ((j = i + 1; j < n; j++)); do
        case "${w[$j]}" in
          -*) break ;;
          *)
            saw_working_tree_enum=1
            [ -n "$enum_example" ] || enum_example="find ${w[$j]}"
            return 0 ;;
        esac
      done
      ;;
  esac

  # (b) an origin/… read, and the ls-tree suppressor -------------------------------------
  [ "$head" = "git" ] || return 0
  i=$((i + 1))
  while [ "$i" -lt "$n" ]; do
    case "${w[$i]}" in
      -C | -c | --exec-path | --git-dir | --work-tree | --namespace) i=$((i + 2)) ;;
      -*) i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "$n" ] || return 0

  case "${w[$i]}" in
    ls-tree)
      # enumerating from the ref you read from: the canonical idiom, never blocked
      for ((j = i + 1; j < n; j++)); do
        if is_remote_ref "${w[$j]}" || is_remote_pathspec "${w[$j]}"; then
          saw_ls_tree=1
          return 0
        fi
      done
      ;;
    show | cat-file)
      for ((j = i + 1; j < n; j++)); do
        if is_remote_pathspec "${w[$j]}"; then
          saw_remote_read=1
          [ -n "$read_example" ] || read_example="git ${w[$i]} $(unquote "${w[$j]}")"
          return 0
        fi
      done
      ;;
    grep)
      for ((j = i + 1; j < n; j++)); do
        if is_remote_ref "${w[$j]}"; then
          saw_remote_read=1
          [ -n "$read_example" ] || read_example="git grep … $(unquote "${w[$j]}")"
          return 0
        fi
      done
      ;;
  esac
  return 0
}

split_segments "$cmd"
for seg in "${segments[@]}"; do
  classify_segment "$seg"
done

# Either half alone is correct and ordinary. The DEFECT is the pair, and only when the
# population is never cross-checked against the ref being read.
if [ "$saw_working_tree_enum" = "1" ] && [ "$saw_remote_read" = "1" ] && [ "$saw_ls_tree" = "0" ]; then
  cat >&2 <<EOF
⛔ Blocked: this command takes its file LIST from the working tree and its file CONTENTS
   from origin/main. The result is a zero that looks like a full-tree scan.
   enumeration: $enum_example
   read:        $read_example

The origin/main reading rule covers CONTENTS. It does not cover ENUMERATION. Files that
exist on origin/main but not at this checkout's current HEAD are never iterated, so the
loop cannot report them and cannot know it missed them — every file it does open is read
perfectly correctly, which is what makes the output so convincing.

Measured on objectui, 2026-08-29 (objectstack#13305): working tree 30 workflow files,
origin/main 31. The missing one was .github/workflows/governed-surface-guard.yml, which
declares ready_for_review — the answer to the very question being asked. 10 PRs were
flipped to ready on that reading, during a runner-capacity outage.

⚠️ A zero-hit control does NOT cover this. One was run at the time and passed, because it
was drawn from the same faulty file list: it validated the MATCHER, not the ENUMERATION.
「一个对照必须有能力因为你担心的那个原因而失败;同源对照结构上做不到。」

Enumerate from the ref you are reading from:
  git ls-tree --name-only origin/main <dir>
  git ls-tree -r --name-only origin/main <dir>      # recursive

  # the population/read cross-check, before trusting any zero:
  git ls-tree --name-only origin/main <dir> | wc -l
  ls <dir>/* | wc -l                                # differ? the working tree is not the population

A command that enumerates with git ls-tree is never blocked here, however it then reads.
Either half alone is fine too — this fires only on the two together.

Deliberate exception (the working tree really is the population you mean — e.g. asking
what YOUR branch changed): re-run with OS_ALLOW_TREE_ENUM=1.
EOF
  exit 2
fi

exit 0
