#!/usr/bin/env bash
# Self-test for guard-dispatch-tier.sh — run it after touching that hook:
#
#   .claude/hooks/guard-dispatch-tier.selftest.sh
#
# Feeds the hook the JSON payload shape Claude Code delivers on PreToolUse for an Agent call
# and asserts the block/allow verdict per case. Needs jq (to build payloads and to read
# settings.json) and nothing else: no install, no build, no network. Exit 0 = all cases hold.
#
# The first case is the measured shape: an os-dev dispatch with neither `model` nor `effort`.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hook="$here/guard-dispatch-tier.sh"
settings="$here/../settings.json"
pass=0
fail=0

command -v jq >/dev/null 2>&1 || { echo "selftest needs jq to build payloads" >&2; exit 1; }

LINE='Container & model: `M`, `mode:subagent`, `model: opus (no path-derived mandate)`, `effort: high (M card)`'
PROMPT="No-card order.

$LINE
Branch: claude/issue-7-x"

payload() { # payload <tool> <subagent_type> <model> <effort> <prompt> — an empty value omits the key
  jq -nc --arg t "$1" --arg s "$2" --arg m "$3" --arg e "$4" --arg p "$5" \
    '{tool_name:$t, tool_input:({description:"d", prompt:$p}
       + (if $s == "" then {} else {subagent_type:$s} end)
       + (if $m == "" then {} else {model:$m} end)
       + (if $e == "" then {} else {effort:$e} end))}'
}

expect() { # expect <block|allow> <label> <tool> <subagent_type> <model> <effort> <prompt> [env…]
  local want="$1" label="$2"; shift 2
  local body rc got; body="$(payload "$1" "$2" "$3" "$4" "$5")"; shift 5
  printf '%s' "$body" | env "$@" "$hook" >/dev/null 2>&1; rc=$?
  case "$rc" in 0) got=allow ;; 2) got=block ;; *) got="exit$rc" ;; esac
  if [ "$got" = "$want" ]; then pass=$((pass + 1)); printf '  ok   %-5s  %s\n' "$got" "$label"
  else fail=$((fail + 1)); printf '  FAIL want=%s got=%s  %s\n' "$want" "$got" "$label"; fi
}

says() { # says <needle> <label> <subagent_type> <model> <effort> <prompt>
  local needle="$1" label="$2" out; shift 2
  out="$(payload Agent "$1" "$2" "$3" "$4" | "$hook" 2>&1 >/dev/null)"
  case "$out" in
    *"$needle"*) pass=$((pass + 1)); printf '  ok   says   %s\n' "$label" ;;
    *) fail=$((fail + 1)); printf '  FAIL missing "%s"  %s\n' "$needle" "$label" ;;
  esac
}

echo "== THE MEASURED SHAPE: an os-dev dispatch with no model and no effort =="
expect block 'no model, no effort, no line' Agent os-dev '' '' 'Implement the card.'
expect block 'no model, no effort — even with the line in the prompt' Agent os-dev '' '' "$PROMPT"

echo "== each half alone is not enough =="
expect block 'effort without model' Agent os-dev '' high "$PROMPT"
expect block 'model without effort' Agent os-dev opus '' "$PROMPT"
expect block 'both parameters, no Container & model line in the prompt' Agent os-dev opus high 'Implement the card.'
expect block 'both parameters, the key off the line start is prose' Agent os-dev opus high "as said, $LINE"
expect block 'both parameters, the line carries no effort slot' Agent os-dev opus high 'Container & model: `M`, `mode:subagent`, `model: opus`'
expect block 'both parameters, the effort slot is the unfilled placeholder' Agent os-dev opus high 'Container & model: `M`, `model: opus`, `effort: <medium | high>`'
expect block 'the line says high and the call passes medium' Agent os-dev opus medium "$PROMPT"
expect block 'the line says medium and the call passes high' Agent os-dev opus high 'Container & model: `S`, `mode:subagent`, `model: opus`, `effort: medium`'
expect block 'the same through the older tool name' Task os-dev '' '' "$PROMPT"

echo "== the dispatch that carries both, and says the same on its line =="
expect allow 'model + effort, line effort equal' Agent os-dev opus high "$PROMPT"
expect allow 'the older tool name' Task os-dev opus high "$PROMPT"
expect allow 'undecorated line' Agent os-dev opus medium 'Container & model: S, mode:subagent, model: opus, effort: medium'
expect allow 'bulleted, bold key' Agent os-dev opus high '- **Container & model:** `L`, `mode:cloud`, `model: opus`, `effort: high`'
expect allow 'the effort compares case-insensitively' Agent os-dev opus HIGH 'Container & model: `M`, `model: opus`, `effort: High`'
expect allow 'a reasoned exception is the claim-time table'"'"'s to judge, not this hook'"'"'s' Agent os-dev opus high 'Container & model: `S`, `model: opus`, `effort: high, reason: not mechanical`'

echo "== precision: only os-dev dispatches are judged =="
expect allow 'another subagent type with nothing set' Agent general-purpose '' '' 'Look something up.'
expect allow 'no subagent_type at all' Agent '' '' '' 'Look something up.'
expect allow 'a longer name that merely starts with os-dev' Agent os-dev-helper '' '' 'x'

echo "== the escape hatch, read from the hook's own environment =="
expect allow 'OS_ALLOW_UNTIERED_DISPATCH=1' Agent os-dev '' '' 'Implement the card.' OS_ALLOW_UNTIERED_DISPATCH=1
expect block 'any other value does not open it' Agent os-dev '' '' 'Implement the card.' OS_ALLOW_UNTIERED_DISPATCH=yes

echo "== the refusal says what is missing and where the rule lives =="
says 'execution-duties.md' 'names the rulebook file' os-dev '' '' 'x'
says 'no `model` parameter' 'names the missing model' os-dev '' high "$PROMPT"
says 'no `effort` parameter' 'names the missing effort' os-dev opus '' "$PROMPT"
says 'says `effort: high` and the call passes `effort: medium`' 'names both sides of a mismatch' os-dev opus medium "$PROMPT"
says 'hook itself runs in' 'names the environment the escape hatch is read from' os-dev '' '' 'x'

echo "== fails OPEN on payloads it cannot parse =="
printf '%s' 'not json at all' | "$hook" >/dev/null 2>&1
if [ $? -eq 0 ]; then pass=$((pass + 1)); printf '  ok   allow  <malformed payload>\n'
else fail=$((fail + 1)); printf '  FAIL want=allow  <malformed payload>\n'; fi
printf '%s' '{"tool_name":"Agent"}' | "$hook" >/dev/null 2>&1
if [ $? -eq 0 ]; then pass=$((pass + 1)); printf '  ok   allow  <no tool_input>\n'
else fail=$((fail + 1)); printf '  FAIL want=allow  <no tool_input>\n'; fi

echo "== wiring: settings.json routes Agent and Task to this hook on PreToolUse =="
for tool in Agent Task; do
  routed="$(jq -r --arg t "$tool" '.hooks.PreToolUse[]? | select(.matcher | split("|") | index($t)) | .hooks[]?.command' "$settings" 2>/dev/null)"
  case "$routed" in
    *guard-dispatch-tier.sh*) pass=$((pass + 1)); printf '  ok   wired  %s\n' "$tool" ;;
    *) fail=$((fail + 1)); printf '  FAIL settings.json routes no %s call to guard-dispatch-tier.sh\n' "$tool" ;;
  esac
done

echo
echo "guard-dispatch-tier selftest: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
# A floor, so a matrix that ran nothing cannot read as a pass.
[ "$pass" -ge 31 ] || { echo "guard-dispatch-tier selftest: only $pass case(s) ran — the matrix is 31" >&2; exit 1; }
exit 0
