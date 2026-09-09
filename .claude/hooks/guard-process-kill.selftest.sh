#!/usr/bin/env bash
# Self-test for guard-process-kill.sh — run it after touching that hook:
#
#   .claude/hooks/guard-process-kill.selftest.sh
#
# Feeds the hook the same JSON payload shape Claude Code delivers on PreToolUse and asserts
# the block/allow verdict per command. Needs jq (to build payloads) and nothing else: no
# install, no build, no network. Exit 0 = all cases hold.
#
# The harness is guard-shared-stash.selftest.sh's, one-for-one — same verdict(), expect(),
# stderr_of(), says() and lacks() — because this guard is that guard's shape applied to the
# other shared object. The case matrix is this guard's own, and it pins BOTH sides on
# purpose: a guard for a class this wide is worth nothing if the PID-scoped teardown the
# repo already prescribes comes back red.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hook="$here/guard-process-kill.sh"
pass=0
fail=0

command -v jq >/dev/null 2>&1 || { echo "selftest needs jq to build payloads" >&2; exit 1; }

# verdict <command> [env assignments…] -> prints "block" or "allow"
verdict() {
  local cmd="$1"; shift
  local payload out rc
  payload="$(jq -nc --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}')"
  out="$(printf '%s' "$payload" | env "$@" "$hook" 2>/dev/null)"
  rc=$?
  case "$rc" in
    0) printf 'allow' ;;
    2) printf 'block' ;;
    *) printf 'exit%s' "$rc" ;;
  esac
}

expect() { # expect <block|allow> <command> [env…]
  local want="$1" cmd="$2"; shift 2
  local got; got="$(verdict "$cmd" "$@")"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1)); printf '  ok   %-5s  %s\n' "$got" "$cmd"
  else
    fail=$((fail + 1)); printf '  FAIL want=%s got=%s  %s\n' "$want" "$got" "$cmd"
  fi
}

stderr_of() { # stderr_of <command> [env…] -> the refusal text an agent actually reads
  local cmd="$1"; shift
  local payload
  payload="$(jq -nc --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}')"
  printf '%s' "$payload" | env "$@" "$hook" 2>&1 >/dev/null
}

says() { # says <needle> <label> <command> [env…]
  local needle="$1" label="$2" subject="$3"; shift 3
  local out; out="$(stderr_of "$subject" "$@")"
  case "$out" in
    *"$needle"*) pass=$((pass + 1)); printf '  ok   says   %s\n' "$label" ;;
    *) fail=$((fail + 1)); printf '  FAIL missing "%s"  %s\n' "$needle" "$label" ;;
  esac
}

lacks() { # lacks <needle> <label> <command> [env…]
  local needle="$1" label="$2" subject="$3"; shift 3
  local out; out="$(stderr_of "$subject" "$@")"
  case "$out" in
    *"$needle"*) fail=$((fail + 1)); printf '  FAIL still says "%s"  %s\n' "$needle" "$label" ;;
    *) pass=$((pass + 1)); printf '  ok   lacks  %s\n' "$label" ;;
  esac
}

echo "== the specimen this rule was filed for (objectstack#16182 / PR #16120) =="
expect block "pkill -f 'dispatch-gates.mjs --self-test'"
expect block 'pkill -f dispatch-gates.mjs'

echo "== pkill selects by NAME with or without -f =="
expect block 'pkill node'
expect block 'pkill -9 vitest'
expect block 'pkill -x esbuild'
expect block 'pkill -u root node'
expect block 'pkill --signal TERM node'
expect block 'pkill -f "pnpm --filter @objectstack/spec test"'
expect block '/usr/bin/pkill -f vitest'
expect block 'OS_FOO=1 pkill -f vitest'
# Bare `pkill` — its option loop completes with no PID-family selector, and it is the ONLY
# input that reaches the pidscoped gate at the end of check_pkill. Without this row that gate
# is unpinned: an ablation replacing it with an unconditional allow left this file green at
# 68/0, which is how the hole was found rather than shipped.
expect block 'pkill'

echo "== killall is the spelling a pkill-only rule would go silent on =="
expect block 'killall node'
expect block 'killall -9 node'
expect block 'killall -r "vitest.*"'
expect block 'killall'

echo "== reached through separators and command substitution =="
expect block 'cd /home/user/objectstack && pkill -f vitest'
expect block 'pnpm test; pkill -f vitest'
expect block 'out=$(pkill -f vitest)'

echo "== a pgrep NAME PATTERN feeding a kill is a pkill spelled out longhand =="
expect block 'pgrep -f dispatch-gates.mjs | xargs kill'
expect block 'kill $(pgrep -f vitest)'
expect block 'kill -9 $(pgrep node)'
expect block 'for p in $(pgrep -f vitest); do kill "$p"; done'
expect block 'pgrep -lf node | awk "{print \$1}" | xargs kill -9'

echo "== ps piped through grep into a kill is the hand-rolled spelling of the same thing =="
expect block 'ps aux | grep vitest | awk "{print \$2}" | xargs kill'
expect block 'ps -ef | grep node | xargs kill -9'

echo "== PID-SCOPED kills are the POSITIVE form and must stay allowed =="
expect allow 'kill "$SERVER_PID"'
expect allow 'kill -0 "$SERVER_PID"'
expect allow 'kill -9 12345'
expect allow 'kill -- -"$PGID"'
expect allow 'kill %1'
expect allow 'cmd & pid=$!; kill "$pid"'

echo "== the teardown AGENTS.md itself prescribes: the port is one YOU picked =="
expect allow 'kill $(lsof -ti tcp:38421)'
expect allow 'kill $(lsof -ti tcp:3000) 2>/dev/null'

echo "== pgrep -P / -s select by a handle the caller owns — live in two tracked scripts =="
# scripts/publish-smoke.sh kill_tree() and scripts/gen-sdui-manifest.sh sdui_live_pids().
# A rule that reddened these would be routed around within the hour.
expect allow 'for child in $(pgrep -P "$pid"); do kill "$child"; done'
expect allow 'pgrep -s "$leader" | xargs kill'
expect allow 'kill $(pgrep -P 4242)'
expect allow 'pgrep -P "${frontier// /,}"'

echo "== the same selectors on pkill, with NO pattern operand =="
expect allow 'pkill -P "$pid"'
expect allow 'pkill -s "$sid"'
expect allow 'pkill -P4242'
expect allow 'pkill --help'
# …and adding a pattern to them is blocked again, which is what makes the pair meaningful.
expect block 'pkill -P "$pid" node'
expect block 'pkill -s "$sid" -f vitest'

echo "== reads are reads: nothing dies, so nothing is blocked =="
expect allow 'pgrep -f vitest'
expect allow 'pgrep -lf node'
expect allow 'ps aux | grep node'
expect allow 'ps -o sid= -p "$LEADER" | tr -d " "'
expect allow 'ps aux | grep -c vitest'

echo "== unrelated commands are untouched =="
expect allow 'pnpm --filter @objectstack/spec test'
expect allow 'git status'
expect allow 'node scripts/pm/dispatch-gates.mjs --self-test'
expect allow 'rm -rf node_modules'

echo "== writing ABOUT the ban must not trip the ban (objectstack#4890) =="
expect allow 'grep -n "pkill -f" AGENTS.md'
expect allow 'git grep -n "killall"'
expect allow 'grep -rn "pgrep -f x | xargs kill" .claude/'
expect allow 'echo "never run pkill -f against a shared container"'

echo "== an UNQUOTED \\\" opens no quote, so the kill behind it is still seen (#11738) =="
# Inherited from guard-shared-stash.sh's split_segments(): reading the escaped `\"` as
# OPENING a region that never closes collapses the command into one harmless-headed segment
# and lets the real kill ride through as an argument. The bare forms next door are the
# controls that say the guard was reached at all.
expect block 'echo \" ; pkill -f vitest'
expect block 'echo \" && killall node'
expect allow 'echo \" ; echo hello'
expect allow 'echo \" ; git status'

echo "== an escaped \\\" INSIDE a double-quoted word does NOT close it (#10406 half) =="
# The other direction of the same rule: reading it as CLOSING splits where bash would not
# and turns the tail of a pure READ into a segment judged on its own head word.
expect allow 'grep -rn "he said \"pkill -f vitest\" once" .claude/'
expect block 'echo "he said \"x\"" && pkill -f vitest'

echo "== escape hatch =="
expect allow 'pkill -f vitest' OS_ALLOW_PROCESS_KILL=1
expect allow 'ps aux | grep node | xargs kill' OS_ALLOW_PROCESS_KILL=1

echo "== the refusal leads with the POSITIVE form, and names where the hatch works =="
# A rule that only says "not like this" gets routed into another spelling of the same
# mistake, so the positive form is pinned as text an agent actually reads — not merely as
# an intention in the header. And the hatch sentence must name the environment THIS HOOK
# reads: a VAR=1 command prefix cannot reach it, and an instruction that does not work is
# an invitation to route around the guard (#15971, the same repair the stash guard took).
says 'Kill only a PID you recorded' 'the positive form' 'pkill -f vitest'
says 'hook itself runs in' 'the hatch names the environment this hook reads' 'pkill -f vitest'
lacks 're-run with' 'the refusal does not print an unusable prefix remedy' 'pkill -f vitest'

echo "== payload with no command fails open =="
if printf '%s' '{"tool_name":"Bash","tool_input":{}}' | "$hook" >/dev/null 2>&1; then
  pass=$((pass + 1)); printf '  ok   allow  (empty tool_input)\n'
else
  fail=$((fail + 1)); printf '  FAIL empty tool_input should fail open\n'
fi

echo "== jq-less fallback still parses the command =="
nojq="$(mktemp -d)"
for b in bash env cat sed head grep; do
  p="$(command -v "$b")" && ln -s "$p" "$nojq/$b"
done
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"pkill -f vitest"}}' \
  | PATH="$nojq" "$hook" >/dev/null 2>&1
case "$?" in
  0) got_nojq=allow ;;
  2) got_nojq=block ;;
  *) got_nojq="exit$?" ;;
esac
if [ "$got_nojq" = block ]; then
  pass=$((pass + 1)); printf '  ok   block  (no jq on PATH)\n'
else
  fail=$((fail + 1)); printf '  FAIL no-jq fallback got=%s\n' "$got_nojq"
fi
rm -rf "$nojq"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
