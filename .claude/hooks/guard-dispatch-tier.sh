#!/usr/bin/env bash
# guard-dispatch-tier.sh — PreToolUse guard: an `os-dev` dispatch carries its tier and effort.
# Blocks an Agent / Task call whose `subagent_type` is `os-dev` unless
#   1. `tool_input.model` and `tool_input.effort` are both set, AND
#   2. `tool_input.prompt` carries a `Container & model:` line (at the START of a line)
#      whose `effort:` value equals `tool_input.effort`.
#
# Why: 定档 (.claude/skills/pm-dispatch/references/execution-duties.md, section 〈定档〉) derives
# the tier and the effort per card and says to pass both explicitly. Nothing saw the call that
# did not: an omitted `model` runs the os-dev definition's pinned floor, an omitted `effort`
# inherits whatever the dispatching session runs at, and the dev then works a whole card at a
# tier and effort nobody derived. The prompt's line is the half the dev and the reviewer read;
# comparing it to the parameter is what keeps the written effort and the served one the same.
#
# What it deliberately does NOT judge: whether the effort is the RIGHT one for the card's size,
# or whether the tier word on the line matches the `model` alias (the line carries a tier word,
# the parameter a harness alias). The table lives in one place — `EFFORT_BY_SIZE` in
# scripts/pm/dispatch-gates.mjs — and is enforced when the claim is written
# (`claimTierWriteRefusal`, through scripts/pm/post-stamped.mjs). That refusal is also the
# backstop where this hook never loads: a multi-repo project thread reads no repo settings.json.
#
# Precision-first, like its siblings: any other `subagent_type` is allowed untouched, and a
# payload it cannot parse (no jq, malformed JSON) is allowed through — the rule outranks the hook.
#
# Deliberate exception: OS_ALLOW_UNTIERED_DISPATCH=1 in the environment this hook runs in.
# Self-test (no network, no build): .claude/hooks/guard-dispatch-tier.selftest.sh

set -uo pipefail

[ "${OS_ALLOW_UNTIERED_DISPATCH:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

input="$(cat 2>/dev/null || true)"
field() { printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null || true; }

[ "$(field '.tool_input.subagent_type')" = "os-dev" ] || exit 0

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
model="$(field '.tool_input.model')"
effort="$(lower "$(field '.tool_input.effort')")"
# The key line as scripts/pm/dispatch-gates.mjs reads it (CONTAINER_MODEL_KEY_LINE): line start,
# with a leading blockquote, a bullet, bold or backticks round the key tolerated.
line="$(field '.tool_input.prompt' |
  grep -m1 -E '^[[:space:]]*(>[[:space:]]*)?([-*][[:space:]]+)?(\*\*)?`?Container & model`?(\*\*)?[[:space:]]*:' || true)"
# The declared effort: the first token after the line's first `effort:` key, decoration stripped.
declared="$(lower "$(printf '%s\n' "$line" | grep -oiE 'effort[[:space:]]*:[[:space:]`*]*[A-Za-z]+' | head -1 |
  sed -E 's/^.*[^A-Za-z]([A-Za-z]+)$/\1/')")"

problems=""
note() { problems="${problems}   - $1"$'\n'; }
[ -n "$model" ] || note 'no `model` parameter: the dev would run at the os-dev definition'"'"'s pinned floor'
[ -n "$effort" ] || note 'no `effort` parameter: the dev would inherit the dispatching session'"'"'s effort'
if [ -z "$line" ]; then
  note 'the prompt carries no `Container & model:` line at the start of a line'
elif [ -z "$declared" ]; then
  note 'the prompt'"'"'s `Container & model:` line reads no `effort:` value'
elif [ -n "$effort" ] && [ "$declared" != "$effort" ]; then
  note "the prompt's line says \`effort: $declared\` and the call passes \`effort: $effort\`"
fi
[ -n "$problems" ] || exit 0

cat >&2 <<EOF
⛔ Blocked: an os-dev dispatch that does not carry its tier and effort.
$problems
定档 — .claude/skills/pm-dispatch/references/execution-duties.md, section 〈定档〉 — derives both
per card, and both are passed explicitly, never left to a default. Re-send the call with
\`model\` and \`effort\` set, and the same effort on the prompt's line:

  Container & model: \`SIZE\`, \`mode:subagent\`, \`model: TIER (quoting this run's dispatch-gates --tier)\`, \`effort: VALUE\`

Which effort a size reads is 定档's table; its one machine copy is \`EFFORT_BY_SIZE\` in
scripts/pm/dispatch-gates.mjs, and the claim is refused on it when it is written.

Deliberate exception: set OS_ALLOW_UNTIERED_DISPATCH=1 in the environment this
hook itself runs in — a local settings "env" entry, or whatever this agent process was started with.
EOF
exit 2
