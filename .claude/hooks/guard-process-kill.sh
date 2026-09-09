#!/usr/bin/env bash
# guard-process-kill.sh — PreToolUse guard: the PROCESS TABLE is SHARED by every agent in
# this container. Blocks Bash commands that select processes BY NAME and kill them, and
# lets every PID-scoped form through.
#
# Why: worktree isolation (AGENTS.md Prime Directive #11, enforced by guard-main-checkout*.sh)
# gives each agent its own checkout, its own index and its own HEAD. It gives it NOTHING
# here. There is ONE process table per container, so a name-matched kill reaches every
# process in it regardless of which worktree spawned it — exactly the way refs/stash is one
# stack for every worktree, which is why guard-shared-stash.sh exists and why this guard is
# built in its shape rather than a new one.
#
# And it shares the property that makes the stash rule a RULE rather than advice: it reports
# SUCCESS either way. `pkill -f foo` exits 0 when it matched *something*, so the agent that
# fired it observes nothing at all, while the agent whose run was destroyed sees a killed
# process and a truncated log with no signal connecting it to the neighbour that did it —
# and re-runs, blaming a flake. The damage lands on someone ELSE's work: the one who caused
# it cannot see it and the one who suffered it cannot attribute it, so this failure does not
# get rarer with experience. It just gets recorded as flakiness.
#
# Provenance, objectstack#16182 (graded from a SELF-REPORT, not an audit catch): the
# implementer on PR #16120 volunteered in its own delivery report, after the work was
# already green, that it had run `pkill -f 'dispatch-gates.mjs --self-test'` to clear a
# lingering self-test of its own. Four agents were live in that container at the time, and
# `node scripts/pm/dispatch-gates.mjs --self-test` is a command essentially every
# implementer in this fleet runs before pushing — a pattern kill on that string is a coin
# flip against whoever else is mid-run. Nothing was lost that day (the process was its own
# and had already exited) and no gate could have seen the near-miss.
#
# ## The rule, in its POSITIVE form — which is the half that has to be written down
#
#   KILL ONLY A PID YOU RECORDED.
#
# Record the pid when you start the thing (`cmd & pid=$!`, a pidfile, `lsof -ti tcp:PORT`
# for the server you yourself started), then signal THAT pid. A rule that only says "not
# like this" gets routed around into another spelling of the same mistake, which is why the
# refusal text below leads with the positive form and why the class — not one binary — is
# what this guard blocks.
#
# ## The class this blocks: selection by NAME, never selection by PID
#
#   pkill …            — a name/pattern matcher by construction, with or without -f
#   killall …          — the same thing under another name (the spelling the ban would go
#                        silent on if it named `pkill -f` alone)
#   pgrep PATTERN piped into, or substituted into, a kill — including `| xargs kill`
#   ps … | grep … in a command that also kills — the hand-rolled spelling of pgrep
#
# ## What is deliberately ALLOWED, because it is PID-scoped and this repo prescribes it
#
#   kill "$SERVER_PID" / kill -0 "$PID" / kill -- -"$PGID"     — a pid or a group you own
#   kill $(lsof -ti tcp:38421)                                 — AGENTS.md's own dev-server
#                                                                teardown: the port is one
#                                                                you picked, not a name
#   pgrep -P "$pid" / pgrep -s "$leader" — even piped into a kill: the selector is a parent
#                                          or session handle the caller owns, and both are
#                                          live in scripts/publish-smoke.sh and
#                                          scripts/gen-sdui-manifest.sh
#   pkill -P "$pid" / pkill -s "$sid"    — the same selectors on pkill, with NO pattern
#                                          operand. Add a pattern and it is blocked again.
#   pgrep -f foo / ps aux | grep node    — a READ. Nothing dies; look all you like.
#
# Deliberate exception (you know the match can only be yours): OS_ALLOW_PROCESS_KILL=1.
#
# Exit-code contract, mirroring guard-shared-stash.sh and guard-main-checkout.sh:
# 0 = allow, 2 = block with the reason on stderr. Anything this cannot parse fails OPEN — a
# guard that blocks work it does not understand gets disabled, and then it guards nothing.
#
# Known boundaries, stated so nobody has to rediscover them:
#
#   1. Like guard-shared-stash.sh, the check reads the FIRST WORD of each shell segment, so
#      a wrapped invocation (bash -c '…', ssh host '…', a script file) is not caught. That
#      is the deliberate trade: the target is the reflexive one-liner an agent reaches for
#      mid-task, not a determined evader, and the escape hatch already exists for anyone who
#      means it. Matching the string anywhere in the command would block every `grep pkill`
#      run against this very file.
#   2. The pgrep/ps coupling is WHOLE-COMMAND, not pipeline-precise: a name-pattern selector
#      and a kill in one command line block each other even when they are unrelated
#      (`kill "$PID" && pgrep -f node`). Pipeline-exact coupling needs separator bookkeeping
#      this pass deliberately does not carry, and the over-block errs toward the rule with a
#      one-variable way out — the direction this guard is willing to be wrong in.
#
# Self-test (no network, no build): .claude/hooks/guard-process-kill.selftest.sh

set -uo pipefail

[ "${OS_ALLOW_PROCESS_KILL:-}" = "1" ] && exit 0

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
# Copied case-for-case from guard-shared-stash.sh's split_segments(), including both of its
# measured escape repairs, because the two guards face the identical parsing problem and a
# divergence here would be a silent hole in one of them:
#
#   - a separator inside '…' or "…" does NOT split, so writing ABOUT the ban is never caught
#     by the ban (objectstack#4890: the PR writing a rule must not trip it);
#   - OUTSIDE quotes a backslash escapes the NEXT character, so an escaped `\"` opens no
#     quoted region at all — reading it as opening one collapses the whole command into a
#     single harmless-headed segment and lets the real kill ride through as an argument
#     (#11738 on the stash guard, #11131 on guard-main-checkout-bash.sh);
#   - INSIDE "…" the rule inverts: `\"` is a literal quote that leaves the region OPEN, and
#     reading it as closing splits where bash would not, turning the tail of a pure READ
#     into a segment judged on its own head word — a false BLOCK (#11804 / #10406).
#
# Both characters are kept verbatim: this pass only SPLITS, and the classifiers below
# re-read the words afterwards.
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

# --- words and effective head word of one segment ---------------------------------------
# Sets W (the segment's words), HEAD_I (index of the command word) and HEAD (that word with
# any leading path stripped, so /usr/bin/pkill reads as pkill). Returns 1 when the segment
# carries no command word at all — an empty segment, or nothing but assignments.
#
# Leading FOO=bar assignments are skipped the way guard-shared-stash.sh skips them. The
# keyword list is this guard's own addition and it is load-bearing: `for p in $(…); do kill
# $p; done` splits so that the killing segment begins with `do`, and a pass that reads `do`
# as the command word would not see the kill at all.
W=()
HEAD=""
HEAD_I=0
seg_words() {
  W=()
  read -r -a W <<<"$1"
  HEAD=""
  HEAD_I=0
  local n=${#W[@]} i=0
  while [ "$i" -lt "$n" ]; do
    case "${W[$i]}" in
      [A-Za-z_][A-Za-z0-9_]*=*) i=$((i + 1)) ;;
      do | then | else | elif | time | exec | nohup | sudo | command | '!') i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "$n" ] || return 1
  HEAD_I=$i
  HEAD="${W[$i]##*/}"
  return 0
}

# --- pkill: block unless the selectors are PID-family and there is NO pattern operand ----
# Fail-CLOSED once the command word is confidently pkill, exactly as guard-shared-stash.sh
# is fail-closed once it has confidently identified `git stash`: an option this does not
# recognise is blocked rather than waved through, because the unrecognised half of pkill's
# option space is where -f, -x, -u and the signal flags live.
check_pkill() {
  local n=${#W[@]} i=$((HEAD_I + 1)) pidscoped=0
  while [ "$i" -lt "$n" ]; do
    case "${W[$i]}" in
      --help | -h | --version | -V) return 0 ;;   # reading the manual is not killing
      --) return 1 ;;                             # everything after it is a pattern
      -P | --parent | -s | --session | -g | --pgroup | -t | --terminal)
        pidscoped=1 ; i=$((i + 2)) ;;
      -P* | -s* | -g* | -t* | --parent=* | --session=* | --pgroup=* | --terminal=*)
        pidscoped=1 ; i=$((i + 1)) ;;
      *) return 1 ;;                              # any other option, and every operand
    esac
  done
  [ "$pidscoped" -eq 1 ] && return 0
  return 1
}

# --- killall: every operand it takes is a NAME, so only its read-only options survive ----
check_killall() {
  local n=${#W[@]} i=$((HEAD_I + 1))
  while [ "$i" -lt "$n" ]; do
    case "${W[$i]}" in
      --help | -h | --version | -V | -l | --list) return 0 ;;
      *) return 1 ;;
    esac
  done
  return 1
}

# --- does this segment select processes by NAME? (pgrep with a bare pattern operand) -----
# Returns 0 = yes, this is a name-pattern selector. `pgrep -s "$leader"` and
# `pgrep -P "$pid"` consume their argument and leave no operand behind, so they answer 1 —
# which is what keeps scripts/publish-smoke.sh and scripts/gen-sdui-manifest.sh legal.
is_name_selector() {
  [ "$HEAD" = "pgrep" ] || return 1
  local n=${#W[@]} i=$((HEAD_I + 1))
  while [ "$i" -lt "$n" ]; do
    case "${W[$i]}" in
      --) i=$((i + 1)) ; [ "$i" -lt "$n" ] && return 0 ; return 1 ;;
      -d | --delimiter | -P | --parent | -s | --session | -g | --pgroup | -t | --terminal \
        | -u | --euid | -U | --uid | -G | --group | -F | --pidfile | --ns | --nslist)
        i=$((i + 2)) ;;
      -*) i=$((i + 1)) ;;
      *) return 0 ;;
    esac
  done
  return 1
}

# --- does this segment kill something? ---------------------------------------------------
is_kill_sink() {
  local j n=${#W[@]}
  case "$HEAD" in
    kill) return 0 ;;
    xargs)
      for ((j = HEAD_I + 1; j < n; j++)); do
        case "${W[$j]##*/}" in kill | pkill | killall) return 0 ;; esac
      done
      ;;
  esac
  return 1
}

refuse() {
  local what="$1" offending="$2"
  cat >&2 <<EOF
⛔ Blocked: this kills processes BY NAME, and the process table is ONE table shared by
   every agent in this container.
   $what
   command: $offending

Kill only a PID you recorded. Worktree isolation (AGENTS.md Prime Directive #11) gives you
your own checkout, index and HEAD; it gives you nothing here, exactly as it gives you
nothing over the shared stash stack. A name match reaches whatever a parallel agent happens
to be running under that name right now — and it reports SUCCESS either way: you see exit
0, they see a killed process and a truncated log with nothing tying it back to you, and
they re-run and blame a flake. objectstack#16182 records the near-miss that filed this rule:
\`pkill -f 'dispatch-gates.mjs --self-test'\` fired in a container holding four live agents,
against a command every implementer here runs before pushing.

Use instead — record the pid, then signal that pid:
  cmd & pid=\$!            ; kill "\$pid"          # you started it, you have its pid
  kill \$(lsof -ti tcp:38421)                      # the dev server on the port YOU picked
  kill -- -"\$pgid"                                # a process group you own
  for c in \$(pgrep -P "\$pid"); do kill "\$c"; done  # children of a pid you recorded

Already allowed, no flag needed:
  kill / kill -0 / kill -9 on a pid, a job spec or your own group
  pgrep -P PID | pgrep -s SID | pkill -P PID | pkill -s SID     # no name pattern anywhere
  pgrep -f PATTERN | ps aux | grep name                          # reads: nothing dies

Deliberate exception (the match really can only be yours): set OS_ALLOW_PROCESS_KILL=1 in
the environment this hook itself runs in — a local settings "env" entry, or whatever this
agent process was started with. A VAR=1 prefix on a command sets it for that command only,
and this hook is not that command, so a prefix never reaches it.
EOF
  exit 2
}

split_segments "$cmd"

saw_ps=0
saw_grep=0
saw_name_selector=0
saw_kill_sink=0
first_selector=""
first_sink=""

for seg in "${segments[@]}"; do
  seg_words "$seg" || continue
  trimmed="${seg#"${seg%%[![:space:]]*}"}"

  case "$HEAD" in
    pkill)
      check_pkill && continue
      refuse "pkill matches process NAMES, with or without -f." "$trimmed" ;;
    killall)
      check_killall && continue
      refuse "killall matches process NAMES — the spelling a pkill-only rule goes silent on." \
        "$trimmed" ;;
    ps) saw_ps=1 ;;
    grep | egrep | fgrep | rg)
      saw_grep=1
      [ -n "$first_selector" ] || first_selector="$trimmed" ;;
  esac

  if is_name_selector; then
    saw_name_selector=1
    [ -n "$first_selector" ] || first_selector="$trimmed"
  fi
  if is_kill_sink; then
    saw_kill_sink=1
    [ -n "$first_sink" ] || first_sink="$trimmed"
  fi
done

if [ "$saw_kill_sink" -eq 1 ]; then
  if [ "$saw_name_selector" -eq 1 ]; then
    refuse "a pgrep NAME PATTERN feeding a kill is a pkill spelled out longhand." \
      "$first_selector … $first_sink"
  fi
  if [ "$saw_ps" -eq 1 ] && [ "$saw_grep" -eq 1 ]; then
    refuse "ps piped through grep into a kill is a pkill spelled out longhand." \
      "$first_selector … $first_sink"
  fi
fi

exit 0
