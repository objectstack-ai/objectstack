#!/usr/bin/env bash
# copied from objectstack@338297e46018ae96256262590a308c8be735f825
# Self-test for guard-shared-stash.sh — run it after touching that hook:
#
#   .claude/hooks/guard-shared-stash.selftest.sh
#
# Feeds the hook the same JSON payload shape Claude Code delivers on PreToolUse and
# asserts the block/allow verdict per command. Needs jq (to build payloads) and nothing
# else: no install, no build, no network. Exit 0 = all cases hold.

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
  # The direction only an ABSENCE assertion can hold: a remedy that stopped being true stays
  # in the text a reader acts on long after the thing it described stopped working.
  local needle="$1" label="$2" subject="$3"; shift 3
  local out; out="$(stderr_of "$subject" "$@")"
  case "$out" in
    *"$needle"*) fail=$((fail + 1)); printf '  FAIL still says "%s"  %s\n' "$needle" "$label" ;;
    *) pass=$((pass + 1)); printf '  ok   lacks  %s\n' "$label" ;;
  esac
}

echo "== mutating forms must be blocked =="
expect block 'git stash'
expect block 'git stash push -- packages/fields/src/RecordPickerDialog.tsx'
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
expect block 'cd /home/user/objectui && git stash pop'
expect block 'git -C ../objectui-issue-3422 stash pop'
expect block 'out=$(git stash pop)'
expect block 'git status && git stash push -m wip; pnpm test'

echo "== read-only and SHA-pinned forms are allowed =="
expect allow 'git stash list'
expect allow 'git stash show -p'
expect allow 'git stash create'
expect allow 'git stash --help'
expect allow 'git stash apply abc1234'
expect allow 'git stash apply --index deadbeefcafe1234'
expect allow 'git stash store -m "WIP issue-3430" b52e3aa1234567'

echo "== unrelated commands are untouched =="
expect allow 'pnpm --filter @object-ui/app-shell test'
expect allow 'git status'
expect allow 'git commit -am wip'
expect allow 'git diff > /tmp/wip.patch && git checkout -- packages/fields'

echo "== writing ABOUT the ban must not trip the ban =="
expect allow 'grep -n "git stash" AGENTS.md'
expect allow 'grep -rn "cd x && git stash pop" .claude/'
expect allow 'echo "never run git stash pop in a shared checkout"'
expect allow 'git grep -n "git stash"'

echo "== an UNQUOTED \\\" opens no quote, so the stash behind it is still seen (objectstack#11131) =="
# The measured hole: segmentation read the escaped `"` as OPENING a quoted region that never
# closed. Every separator behind it went inert, the command collapsed into one `echo`
# segment, and the real `git stash` was just another argument.
expect block 'echo \" ; git stash'
expect block 'echo \" ; git stash pop'
expect block 'printf \" ; git stash drop'
expect block "$(printf 'echo \\"\ngit stash pop\n')"
# Precision twins: the escape must not manufacture a stash where none is run, and the forms
# this guard deliberately allows stay allowed when reached through the same escape. (Upstream's
# twin aims the command at a linked worktree; this hook reads no cwd, so the SHA-pinned and
# read-only allow-list is the analogous precision surface.)
expect allow 'echo \" ; echo hello'
expect allow 'echo \" ; cat README.md'
expect allow 'echo a\ b'
expect allow 'echo \\ ; grep -n worktree README.md'
expect allow 'echo \" ; git stash list'

echo "== an escaped \\\" INSIDE a double-quoted word does NOT close it =="
# Inside "…" a backslash is special only before " \ $ ` — so an escaped `\"` is a literal
# quote and the quoted region stays OPEN. A pass that reads it as closing goes "outside
# quotes" while bash is still inside: separators behind it split where bash would not, and
# the tail of a pure READ becomes a segment of its own, judged on its own head word. The
# single-level control above (`grep -rn "cd x && git stash pop" .claude/`) is the same
# command without the nested escape, so it isolates that escape as the only difference.
expect allow 'grep -rn "he said \"cd x && git stash pop\" once" .claude/'
expect allow 'echo "he said \"x && git stash pop\" once"'
# Precision twins — this is not a blanket "ignore whatever follows a backslash". Once the
# escapes pair up the region really is closed, and the stash behind it is still caught.
expect block 'echo "he said \"x\"" && git stash pop'
expect block 'echo "he said \"x\"" ; git stash drop'
expect block 'echo "quoted" && git stash pop'
# `\\` inside "…" is an escaped backslash, so the NEXT `"` still closes the region; without
# the `\` arm of the escapee list that closing quote is eaten and the stash rides through.
expect block 'echo "a \\" ; git stash pop'
# Inside '…' nothing is special — that asymmetry is what the q='"' gate pins. Applied to
# single quotes the branch would swallow the closing `'` and pass the stash behind it.
expect block "echo 'a \\' ; git stash pop"

echo "== a \$(…), backtick or \${…} inside \"…\" is its own quoting context (objectstack#24901) =="
# Reading the `"` inside the body as CLOSING the outer string split the body at its `;`, so a
# pure read became a stash. The first three were BLOCKED before subst_end() existed here; the
# fourth (both kinds nested) was allowed then only because two misread quotes cancelled out,
# and the single-level `echo "x; git stash pop"` was allowed throughout.
expect allow 'echo "a $(echo "x; git stash pop")"'
expect allow 'echo "a `echo "x; git stash pop"`"'
expect allow 'echo "${x:-"a; git stash pop"}"'
expect allow 'echo "${x:-"$(echo "a; git stash pop")"}"'
expect allow 'echo "x; git stash pop"'
# Recall: a stash behind or beside a quoted expansion is still seen.
expect block 'echo "${x:-"a"}" ; git stash pop'
expect block 'X="${Y:-"z"}" && git stash push -m wip'
expect block 'git stash push -m "${msg:-"wip; x"}"'
# The fail-OPEN mirror: the `"` inside the single quotes left the outer string hanging, so the
# separator behind it went inert and the real stash rode through as text. Both were ALLOWED
# before subst_end() existed here.
expect block "echo \"\$(printf '\"')\" ; git stash pop"
expect block "echo \"\${x:-\$(printf '\"')}\" ; git stash pop"
# Deliberately not claimed, as before: a stash INSIDE a quoted substitution is one inert word.
expect allow 'echo "$(git stash pop)"'

echo "== the shared quoting rule is guard-main-checkout-bash.sh's, byte for byte (objectstack#24901) =="
# subst_end() lives in three hooks here. A copy that drifts is a quoting rule the guards no longer
# share, and nothing else notices: each hook's own cases keep passing on its own dialect.
fn_text() { sed -n "/^$1() {\$/,/^}\$/p" "$2"; }
same_fn() { # same_fn <function> <file holding the copy this hook must equal>
  local mine theirs
  mine="$(fn_text "$1" "$hook")"; theirs="$(fn_text "$1" "$2")"
  if [ -n "$mine" ] && [ "${mine%%$'\n'*}" = "$1() {" ] && [ "$mine" = "$theirs" ]; then
    pass=$((pass + 1)); printf '  ok   same   %s() as %s\n' "$1" "${2##*/}"
  else
    fail=$((fail + 1)); printf '  FAIL %s() is missing here or differs from %s\n' "$1" "${2##*/}"
  fi
}
same_fn subst_end "$here/guard-main-checkout-bash.sh"

echo "== escape hatch =="
expect allow 'git stash pop' OS_ALLOW_STASH=1

echo "== the hatch names WHERE it works: this hook's own environment, never a prefix =="
# The refusal used to end by telling the reader to re-run the same thing with the variable
# as a VAR=1 command prefix — an instruction that cannot work where it is printed. A VAR=1
# prefix sets the variable in the environment of THAT COMMAND; this hook is not that
# command, and it reads the variable from its own environment, so the prefix changes
# nothing and the refusal repeats (#15971). An instruction that does not work is an
# invitation to route around the guard, so both directions are pinned: the dead remedy is
# gone, and the sentence names the environment the hook actually reads. The `allow` rows
# next door — the variable really in the hook's environment — are this pair's other half.
lacks 're-run with' 'the refusal no longer prints the prefix remedy' 'git stash pop'
says 'hook itself runs in' 'the refusal names the environment this hook reads' 'git stash pop'

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
