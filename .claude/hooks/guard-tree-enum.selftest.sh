#!/usr/bin/env bash
# Self-test for guard-tree-enum.sh — run it after touching that hook:
#
#   .claude/hooks/guard-tree-enum.selftest.sh
#
# Feeds the hook the same JSON payload shape Claude Code delivers on PreToolUse and asserts
# the block/allow verdict per command. Needs jq (to build payloads) and nothing else: no
# install, no build, no network. Exit 0 = all cases hold.
#
# The first case is the measured objectui incident of 2026-08-29 (objectstack#13305)
# reproduced verbatim; it is the one case whose failure means the guard has stopped doing
# the only job it was written for.
#
# Mirrored one-for-one into objectui's self-test of the same name alongside the hook, so
# the two repos' guards cannot drift; only example paths are localised.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hook="$here/guard-tree-enum.sh"
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

echo "== THE MEASURED SIGNATURE: working-tree list + origin/main read in one command =="
# objectui, 2026-08-29 — the loop that reported "no workflow subscribes ready_for_review"
expect block 'for f in .github/workflows/*.yml; do git show "origin/main:$f" | grep -q ready_for_review && echo "$f"; done'
expect block 'for f in .github/workflows/*.yml; do git show origin/main:$f; done'
expect block 'ls .github/workflows/*.yml | while read f; do git show "origin/main:$f"; done'
expect block 'for f in scripts/*.mjs; do git cat-file -e "origin/main:$f" || echo missing; done'
expect block 'find .github/workflows -name "*.yml" | while read f; do git show "origin/main:$f"; done'
expect block 'for f in packages/spec/src/*.ts; do git grep -q PATTERN origin/main -- "$f"; done'

echo "== reached through separators, env prefixes and git -C =="
expect block 'cd /home/user/objectstack && for f in .claude/hooks/*.sh; do git show "origin/main:$f"; done'
expect block 'for f in docs/adr/*.md; do git -C . show "origin/main:$f" | head -1; done'
expect block 'NODE_OPTIONS=--max-old-space-size=4096 ls scripts/*.mjs | xargs -I{} git show origin/main:{}'

echo "== THE CANONICAL IDIOM is never blocked, however it then reads =="
expect allow 'git ls-tree --name-only origin/main .github/workflows/'
expect allow 'for f in $(git ls-tree --name-only origin/main .github/workflows/); do git show "origin/main:$f"; done'
expect allow 'git ls-tree -r --name-only origin/main scripts/ | while read f; do git show "origin/main:$f"; done'
echo "-- the population/read cross-check the block message recommends must not itself block --"
expect allow 'git ls-tree --name-only origin/main .github/workflows/ | wc -l; ls .github/workflows/* | wc -l; git show origin/main:AGENTS.md | head -1'

echo "== EITHER HALF ALONE is ordinary and correct =="
echo "-- (a) working-tree enumeration with no origin/main read --"
expect allow 'ls .github/workflows/*.yml'
expect allow 'for f in packages/*/package.json; do jq -r .name "$f"; done'
expect allow 'find scripts -name "*.mjs" | wc -l'
expect allow 'for f in .claude/hooks/*.sh; do bash -n "$f"; done'
echo "-- (b) origin/main read with no working-tree enumeration --"
expect allow 'git show origin/main:AGENTS.md | wc -l'
expect allow 'git grep -n ready_for_review origin/main'
expect allow 'git show "origin/main:.github/workflows/governed-surface-guard.yml"'
expect allow 'git cat-file -e origin/main:.github/workflows/ci.yml'
expect allow 'git diff origin/main -- .github/workflows/'

echo "== a LOCAL ref is not the hazard this guard is about =="
expect allow 'for f in .github/workflows/*.yml; do git show "HEAD:$f"; done'
expect allow 'for f in .github/workflows/*.yml; do git show "$BASE:$f"; done'

echo "== writing ABOUT the defect must not trip the guard =="
expect allow 'grep -n "git show origin/main:" AGENTS.md'
expect allow 'grep -rn "for f in .github/workflows/\*.yml" .claude/hooks/'
expect allow 'echo "never feed a working-tree glob into git show origin/main:"'
expect allow 'git grep -n "ls-tree --name-only origin/main"'
expect allow 'cat .claude/hooks/guard-tree-enum.sh'

echo "== unrelated commands are untouched =="
expect allow 'pnpm --filter @objectstack/spec test'
expect allow 'git status'
expect allow 'node scripts/pm/dispatch-gates.mjs --repo objectstack-ai/objectstack'
expect allow 'git worktree add ../objectstack-issue-13305 -b claude/issue-13305 origin/main'

echo "== the deliberate exception releases it =="
expect allow 'for f in .github/workflows/*.yml; do git show "origin/main:$f"; done' OS_ALLOW_TREE_ENUM=1

echo "== fails OPEN on payloads it cannot parse =="
printf '%s' '{"tool_name":"Bash","tool_input":{}}' | "$hook" >/dev/null 2>&1
if [ $? -eq 0 ]; then pass=$((pass + 1)); printf '  ok   allow  <no command in payload>\n'
else fail=$((fail + 1)); printf '  FAIL want=allow  <no command in payload>\n'; fi
printf '%s' 'not json at all' | "$hook" >/dev/null 2>&1
if [ $? -eq 0 ]; then pass=$((pass + 1)); printf '  ok   allow  <malformed payload>\n'
else fail=$((fail + 1)); printf '  FAIL want=allow  <malformed payload>\n'; fi

echo
echo "guard-tree-enum selftest: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
exit 0
