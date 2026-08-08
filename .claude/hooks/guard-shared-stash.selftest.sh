#!/usr/bin/env bash
# Self-test for guard-shared-stash.sh — run it after touching that hook:
#
#   .claude/hooks/guard-shared-stash.selftest.sh
#
# Feeds the hook the same JSON payload shape Claude Code delivers on PreToolUse and
# asserts the block/allow verdict per command. Needs jq (to build payloads) and nothing
# else: no install, no build, no network. Exit 0 = all cases hold.
#
# Mirrored from objectui's self-test of the same name (objectui#3430 / PR #3433) alongside
# the hook itself; the case matrix is kept one-for-one so the two repos' guards cannot
# drift, and only the example paths, worktree names and package name are localised.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hook="$here/guard-shared-stash.sh"
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

echo "== mutating forms must be blocked =="
expect block 'git stash'
expect block 'git stash push -- packages/spec/src/kernel/metadata-plugin.zod.ts'
expect block 'git stash pop'
expect block 'git stash save wip'
expect block 'git stash drop'
expect block 'git stash clear'
expect block 'git stash branch recovered'
expect block 'git stash pop > /dev/null'

echo "== positional stash@{N} is NOT SHA-pinned: still the shared stack =="
expect block 'git stash pop stash@{0}'
expect block 'git stash apply stash@{1}'

echo "== reached through separators, substitution and git -C =="
expect block 'cd /home/user/objectstack && git stash pop'
expect block 'git -C ../objectstack-issue-5742 stash pop'
expect block 'out=$(git stash pop)'
expect block 'git status && git stash push -m wip; pnpm test'

echo "== read-only and SHA-pinned forms are allowed =="
expect allow 'git stash list'
expect allow 'git stash show -p'
expect allow 'git stash create'
expect allow 'git stash --help'
expect allow 'git stash apply abc1234'
expect allow 'git stash apply --index deadbeefcafe1234'
expect allow 'git stash store -m "WIP issue-5742" b52e3aa1234567'

echo "== unrelated commands are untouched =="
expect allow 'pnpm --filter @objectstack/spec test'
expect allow 'git status'
expect allow 'git commit -am wip'
expect allow 'git diff > /tmp/wip.patch && git checkout -- packages/spec'

echo "== writing ABOUT the ban must not trip the ban =="
expect allow 'grep -n "git stash" AGENTS.md'
expect allow 'grep -rn "cd x && git stash pop" .claude/'
expect allow 'echo "never run git stash pop in a shared checkout"'
expect allow 'git grep -n "git stash"'

echo "== escape hatch =="
expect allow 'git stash pop' OS_ALLOW_STASH=1

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
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git stash pop"}}' \
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
