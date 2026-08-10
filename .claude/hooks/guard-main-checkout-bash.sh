#!/usr/bin/env bash
# guard-main-checkout-bash.sh — PreToolUse guard: the SAME worktree-first rule as
# guard-main-checkout.sh, applied to file writes that arrive through Bash instead of
# through the Edit / Write / NotebookEdit tools.
#
# Why: guard-main-checkout.sh is registered on the matcher "Edit|Write|NotebookEdit", so
# it only ever sees tool-shaped file writes. The identical mutation expressed as a shell
# command never reaches it — `sed -i 's/foo/bar/' packages/spec/src/x.ts`,
# `cat > path <<EOF`, `tee`, `printf ... > path` all edit the shared primary checkout in
# silence, while CLAUDE.md and AGENTS.md Prime Directive #11 tell every agent that "a
# PreToolUse hook enforces this rule". Declared enforcement scope > actual enforcement
# scope (#5790). This hook closes the Bash half.
#
# Ported from objectui's hook of the same name (objectstack-ai/objectui#3452, filed there
# as objectui#3435) — the logic below is deliberately kept case-for-case identical to it so
# the two repos' guards cannot drift; only issue references, example paths and the package
# name in the self-test are localised. The Bash matcher this hook created is now shared
# with guard-shared-stash.sh, mirrored here from objectui in the same way (#5742) — the
# gap #5790's closing observation recorded is closed; both hooks run on this one matcher.
#
# The rule and the escape hatch are deliberately the SAME as guard-main-checkout.sh's:
# OS_ALLOW_MAIN_EDITS=1. One rule, one hatch — a second variable would just be another
# thing to forget.
#
# Repo predicate — lifted verbatim from guard-main-checkout.sh so the two hooks can never
# disagree about what "shared checkout" means:
#   resolve the target's nearest EXISTING ancestor dir -> `git rev-parse --git-dir`
#     * not a git repo at all (/tmp, $HOME dotfiles, the scratchpad)  -> allow
#     * git-dir matches */worktrees/*  (a linked worktree)            -> allow
#     * anything else (the shared PRIMARY checkout, any sibling repo) -> BLOCK
#
# PRECISION OVER RECALL. Recognising a write target inside an arbitrary shell command is
# heuristic in a way that Edit's file_path is not, and a guard that blocks work it does not
# understand gets switched off — after which it guards nothing. So this hook only claims
# shapes it can read with confidence, and everything else fails OPEN:
#   > / >> redirection (incl. fd-prefixed 2>), sed -i, perl -i, tee, cp, mv, rm, touch.
# Reads are never touched: grep / cat FILE / ls / git grep produce no write target.
#
# Fails open, deliberately, on:
#   - wrapped invocations: bash -c '…', xargs, ssh host '…', make, a shell script that
#     writes (the target is one indirection away from any token this hook can see);
#   - programs whose writes live inside their own source text: python -c "open(p,'w')",
#     node -e, awk > (the target is not a shell token, so there is nothing to read);
#   - any target containing an expansion or glob ($VAR, `…`, $(…), *, ?, ~) — unresolvable
#     without running it;
#   - relative targets when the payload carries no cwd.
# Each of those is a hole by choice, not by accident: OS_ALLOW_MAIN_EDITS=1 already exists
# for anyone who means to write there, and the target of this guard is the reflexive
# `sed -i` an agent reaches for mid-task, not a determined evader.
#
# Writing ABOUT the ban must never trip the ban (#4890's lesson). Two layers:
#   1. quote-aware segmentation + tokenisation — a `>` or a `sed -i` inside '…' or "…" is
#      literal text, so `grep -n "sed -i" .claude/` and `echo "never sed -i in main"` pass;
#   2. heredoc bodies are stripped before analysis — the LINES of a `cat > /tmp/notes <<EOF`
#      body are documentation, not commands, and segmentation alone (which splits on
#      newlines) would happily read them as such.
#
# Exit-code contract, mirroring guard-main-checkout.sh: 0 = allow, 2 = block with the reason
# on stderr.
#
# Self-test (block + allow + hatch + fail-open + no-jq matrix, no network, no build):
#   .claude/hooks/guard-main-checkout-bash.selftest.sh

set -uo pipefail

[ "${OS_ALLOW_MAIN_EDITS:-}" = "1" ] && exit 0

input="$(cat 2>/dev/null || true)"
cmd=""
cwd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
  cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
fi
if [ -z "$cmd" ]; then
  # jq-less fallback: lift the JSON string value honouring backslash escapes (so an
  # embedded \" does not truncate the command), then unescape what matters for shell text.
  cmd="$(printf '%s' "$input" \
    | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(\(\\.\|[^"\\]\)*\)".*/\1/p' \
    | head -1 \
    | sed 's/\\n/\n/g; s/\\t/ /g; s/\\"/"/g; s/\\\\/\\/g')"
fi
if [ -z "$cwd" ]; then
  cwd="$(printf '%s' "$input" \
    | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\(\(\\.\|[^"\\]\)*\)".*/\1/p' \
    | head -1 \
    | sed 's/\\"/"/g; s/\\\\/\\/g')"
fi

[ -n "$cmd" ] || exit 0

# --- heredoc bodies are text, not commands ---------------------------------------------
# `cat > /tmp/notes.md <<EOF` … `EOF` carries prose over several lines. Segmentation splits
# on newlines, so without this pass a documented example inside the body ("sed -i … main
# checkout") would be analysed as if the agent had run it. Drop body lines (and their
# terminator); the introducing line — which is where the real redirection lives — stays.
strip_heredocs() {
  local s="$1" out="" line scan d t
  local -a pending=()
  while IFS= read -r line; do
    if [ "${#pending[@]}" -gt 0 ]; then
      t="${line#"${line%%[![:space:]]*}"}"    # ltrim, for the <<- form
      if [ "$t" = "${pending[0]}" ] || [ "$line" = "${pending[0]}" ]; then
        pending=("${pending[@]:1}")
      fi
      continue
    fi
    out+="$line"$'\n'
    # `<<<` is a herestring, not a heredoc — mask it before hunting for delimiters.
    scan="${line//<<</__OS_HERESTRING__}"
    case "$scan" in
      *'<<'*)
        while IFS= read -r d; do
          [ -n "$d" ] && pending+=("$d")
        done < <(printf '%s\n' "$scan" \
          | grep -oE "<<-?[[:space:]]*(\"[^\"]*\"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*)" 2>/dev/null \
          | sed -E "s/^<<-?[[:space:]]*//; s/^[\"']//; s/[\"']$//")
        ;;
    esac
  done <<<"$s"
  printf '%s' "$out"
}

# --- split the command into shell segments, honouring quotes ---------------------------
# A separator inside '…' or "…" does NOT split, so writing *about* the ban is never caught
# by the ban.
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

# --- tokenise ONE segment, quote-aware -------------------------------------------------
# The whole argument list matters here, and `read -r -a` would promote a QUOTED ">" or
# "sed -i" to a real operator/command — exactly the false positive that makes a guard get
# disabled. So: quotes are stripped and their contents are inert.
# TOK[] = token values (unquoted); TOP[] = "op" for an unquoted redirection operator.
TOK=(); TOP=()
tokenize() {
  TOK=(); TOP=()
  local s="$1" n=${#1} i ch q="" tok="" have=0 op
  for ((i = 0; i < n; i++)); do
    ch="${s:i:1}"
    if [ -n "$q" ]; then
      if [ "$ch" = "$q" ]; then q=""; else tok+="$ch"; fi
      have=1
      continue
    fi
    case "$ch" in
      "'" | '"') q="$ch" ; have=1 ;;
      '\')
        i=$((i + 1))
        if [ "$i" -lt "$n" ]; then tok+="${s:i:1}" ; have=1 ; fi
        ;;
      ' ' | $'\t')
        if [ "$have" = 1 ]; then TOK+=("$tok") ; TOP+=("") ; tok="" ; have=0 ; fi
        ;;
      '>' | '<')
        # a bare leading fd ("2>") belongs to the operator, not to the previous word
        if [ "$have" = 1 ] && [[ ! "$tok" =~ ^[0-9]+$ ]]; then
          TOK+=("$tok") ; TOP+=("")
        fi
        tok="" ; have=0
        op="$ch"
        while [ $((i + 1)) -lt "$n" ] && [ "${s:i+1:1}" = "$ch" ]; do op+="$ch" ; i=$((i + 1)) ; done
        TOK+=("$op") ; TOP+=("op")
        ;;
      *) tok+="$ch" ; have=1 ;;
    esac
  done
  if [ "$have" = 1 ]; then TOK+=("$tok") ; TOP+=("") ; fi
}

# --- the repo predicate, identical to guard-main-checkout.sh's ------------------------
# 0 = this target lands in a shared primary checkout (block it), 1 = fine / unknowable.
target_is_shared_checkout() {
  local p="$1" d gitdir
  [ -n "$p" ] || return 1
  [ "$p" = "-" ] && return 1                 # stdout, not a file

  # Unresolvable without executing the command: expansions, command substitution, globs,
  # tilde. Fail OPEN rather than guess a path.
  case "$p" in
    *'$'* | *'`'* | *'*'* | *'?'* | '~'* | *'['*) return 1 ;;
  esac

  if [ "${p#/}" = "$p" ]; then
    # relative: needs a cwd we actually know
    [ -n "$cwd" ] || return 1
    p="$cwd/$p"
  fi

  d="$(dirname "$p")"
  while [ -n "$d" ] && [ "$d" != "/" ] && [ ! -d "$d" ]; do d="$(dirname "$d")"; done
  [ -d "$d" ] || return 1

  gitdir="$(git -C "$d" rev-parse --git-dir 2>/dev/null)" || return 1
  case "$gitdir" in
    */worktrees/*) return 1 ;;
  esac
  return 0
}

# --- write-target extraction ------------------------------------------------------------
# Fills TARGETS[] with the paths a segment would WRITE. Empty = nothing recognised.
TARGETS=()

is_opt() { case "$1" in -?*) return 0 ;; *) return 1 ;; esac; }

# sed/perl in-place flag: `-i`, `-i.bak`, `--in-place[=SUF]`, or an all-lowercase short
# cluster containing i (`-ri`, `-pi`). The all-lowercase rule keeps perl's `-Ilib` out.
is_inplace_flag() {
  case "$1" in
    --in-place | --in-place=*) return 0 ;;
    -i*) return 0 ;;
  esac
  [[ "$1" =~ ^-[a-z]+$ ]] && [[ "$1" == *i* ]] && return 0
  return 1
}

collect_targets() {
  TARGETS=()
  local -a w=()
  local i n j

  # drop redirection operators and their targets, so w[] is the plain argv
  n=${#TOK[@]}
  for ((i = 0; i < n; i++)); do
    if [ "${TOP[$i]}" = "op" ]; then
      case "${TOK[$i]}" in
        '>' | '>>')
          # the redirection itself is a write; record its target
          j=$((i + 1))
          if [ "$j" -lt "$n" ] && [ "${TOP[$j]}" != "op" ]; then TARGETS+=("${TOK[$j]}"); fi
          ;;
      esac
      # skip the operator and, when present, its filename/delimiter operand
      j=$((i + 1))
      if [ "$j" -lt "$n" ] && [ "${TOP[$j]}" != "op" ]; then i=$j; fi
      continue
    fi
    w+=("${TOK[$i]}")
  done

  n=${#w[@]}
  i=0
  [ "$n" -gt 0 ] || return 0

  # leading FOO=bar environment assignments
  while [ "$i" -lt "$n" ]; do
    case "${w[$i]}" in
      [A-Za-z_][A-Za-z0-9_]*=*) i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "$n" ] || return 0

  local cmdname="${w[$i]##*/}"
  i=$((i + 1))

  case "$cmdname" in
    sed | perl)
      local inplace=0 explicit_script=0 script_taken=0 rest=0
      local -a files=()
      for ((j = i; j < n; j++)); do
        local a="${w[$j]}"
        if [ "$rest" = 0 ]; then
          if [ "$a" = "--" ]; then rest=1; continue; fi
          if is_opt "$a"; then
            is_inplace_flag "$a" && inplace=1
            case "$a" in
              -e* | -f* | --expression* | --file*) explicit_script=1 ;;
            esac
            case "$a" in
              -e | -f | -E | -I | -M | -m | -F | --expression | --file) j=$((j + 1)) ;;
            esac
            continue
          fi
        fi
        if [ "$explicit_script" = 0 ] && [ "$script_taken" = 0 ]; then
          script_taken=1                      # the s/// script itself, not a file
          continue
        fi
        files+=("$a")
      done
      # without an in-place flag, sed/perl write to stdout — only a redirection writes, and
      # that is already in TARGETS.
      if [ "$inplace" = 1 ] && [ "${#files[@]}" -gt 0 ]; then TARGETS+=("${files[@]}"); fi
      ;;

    tee)
      # every non-option operand is written to (-a only chooses append vs truncate)
      for ((j = i; j < n; j++)); do
        [ "${w[$j]}" = "--" ] && continue
        is_opt "${w[$j]}" && continue
        TARGETS+=("${w[$j]}")
      done
      ;;

    cp | mv)
      # destination = -t DIR when given, else the last operand
      local -a ops=()
      local tdir="" rest2=0
      for ((j = i; j < n; j++)); do
        local a="${w[$j]}"
        if [ "$rest2" = 0 ]; then
          if [ "$a" = "--" ]; then rest2=1; continue; fi
          case "$a" in
            -t | --target-directory)
              j=$((j + 1)); [ "$j" -lt "$n" ] && tdir="${w[$j]}"; continue ;;
            --target-directory=*) tdir="${a#*=}" ; continue ;;
            -S | --suffix) j=$((j + 1)); continue ;;
          esac
          is_opt "$a" && continue
        fi
        ops+=("$a")
      done
      if [ -n "$tdir" ]; then
        TARGETS+=("$tdir")
      elif [ "${#ops[@]}" -ge 2 ]; then
        TARGETS+=("${ops[$((${#ops[@]} - 1))]}")
      fi
      ;;

    rm)
      local rest3=0
      for ((j = i; j < n; j++)); do
        if [ "$rest3" = 0 ]; then
          if [ "${w[$j]}" = "--" ]; then rest3=1; continue; fi
          is_opt "${w[$j]}" && continue
        fi
        TARGETS+=("${w[$j]}")
      done
      ;;

    touch)
      local rest4=0
      for ((j = i; j < n; j++)); do
        local a="${w[$j]}"
        if [ "$rest4" = 0 ]; then
          if [ "$a" = "--" ]; then rest4=1; continue; fi
          case "$a" in
            -r | --reference | -d | --date | -t) j=$((j + 1)); continue ;;
          esac
          is_opt "$a" && continue
        fi
        TARGETS+=("$a")
      done
      ;;
  esac
}

# --- track `cd` so relative targets resolve the way the shell would --------------------
# `cd /home/user/objectstack && tee packages/a.ts` writes to the shared checkout even though
# the token is relative. Known boundary: a `cd` inside a subshell is treated as sticky,
# because segmentation does not report WHICH separator it split on.
maybe_cd() {
  local i=0 n=${#TOK[@]}
  local -a plain=()
  for ((i = 0; i < n; i++)); do
    [ "${TOP[$i]}" = "op" ] && continue
    plain+=("${TOK[$i]}")
  done
  n=${#plain[@]}
  [ "$n" -ge 2 ] || return 0
  [ "${plain[0]##*/}" = "cd" ] || return 0
  local d="${plain[1]}"
  case "$d" in
    -* ) return 0 ;;
    *'$'* | *'`'* | *'*'* | '~'* ) cwd="" ; return 0 ;;   # unknowable from here on
  esac
  if [ "${d#/}" = "$d" ]; then
    [ -n "$cwd" ] || return 0
    d="$cwd/$d"
  fi
  cwd="$d"
}

# --- main -------------------------------------------------------------------------------
split_segments "$(strip_heredocs "$cmd")"

for seg in "${segments[@]}"; do
  case "$seg" in *[![:space:]]*) ;; *) continue ;; esac
  tokenize "$seg"
  [ "${#TOK[@]}" -gt 0 ] || continue

  collect_targets
  [ "${#TARGETS[@]}" -gt 0 ] || { maybe_cd ; continue ; }
  for t in "${TARGETS[@]}"; do
    if target_is_shared_checkout "$t"; then
      offending="${seg#"${seg%%[![:space:]]*}"}"
      abs="$t"
      [ "${abs#/}" = "$abs" ] && abs="$cwd/$t"
      root="$(git -C "$(dirname "$abs")" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$abs")"
      name="$(basename "$root")"
      cat >&2 <<EOF
⛔ Blocked: this Bash command WRITES into the shared PRIMARY checkout, not a worktree.
   command: $offending
   target:  $t
   repo:    $root

Same rule as guard-main-checkout.sh — that hook is registered on Edit|Write|NotebookEdit
only, so the identical edit expressed as a shell command used to slip through in silence
(#5790). This repo is edited by multiple agents at once: the shared checkout gets its HEAD
switched and its tree reset under you, clobbering uncommitted work. A feature branch on
the shared checkout is NOT enough; you need a dedicated worktree:

  git worktree add ../${name}-<task> -b <branch> main
  cd ../${name}-<task> && pnpm install    # then re-run the command there

Always fine, no flag needed:
  reads of the shared checkout   grep / cat FILE / ls / git -C <main> grep …
  writes into a linked worktree  sed -i … ../${name}-<task>/packages/…
  writes outside any repo        /tmp/…, the scratchpad, \$HOME dotfiles

Deliberate non-task exception: re-run with OS_ALLOW_MAIN_EDITS=1.
EOF
      exit 2
    fi
  done

  maybe_cd
done

exit 0
