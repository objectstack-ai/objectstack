#!/usr/bin/env bash
# Self-test for guard-main-checkout-bash.sh — run it after touching that hook:
#
#   .claude/hooks/guard-main-checkout-bash.selftest.sh
#
# Feeds the hook the same JSON payload shape Claude Code delivers on PreToolUse and asserts
# the block/allow verdict per command. Hermetic: it builds its OWN throwaway git repo, a
# linked worktree of it, and a non-repo directory under $TMPDIR, so the matrix never depends
# on which machine or which checkout it runs from. Needs jq and git and nothing else — no
# install, no build, no network. Exit 0 = all cases hold.
#
# Ported case-for-case from objectui's matrix of the same name (objectui#3452); only the
# `pnpm --filter` package name is localised to this repo.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hook="$here/guard-main-checkout-bash.sh"
pass=0
fail=0

command -v jq >/dev/null 2>&1 || { echo "selftest needs jq to build payloads" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "selftest needs git to build the fixture" >&2; exit 1; }

# --- fixture: a shared primary checkout, a linked worktree of it, a plain directory -----
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
MAIN="$tmp/mainrepo"
WT="$tmp/wt"
PLAIN="$tmp/plain"
mkdir -p "$MAIN/pkg" "$PLAIN"
(
  cd "$MAIN" || exit 1
  git init -q .
  git config user.email selftest@example.com
  git config user.name selftest
  : > README.md
  : > pkg/x.ts
  git add -A
  git commit -qm init
  git worktree add -q "$WT" -b selftest-wt
) >/dev/null 2>&1 || { echo "could not build the git fixture" >&2; exit 1; }

CWD="$MAIN"   # payload cwd for the cases that follow; reassigned per section

# verdict <command> [env assignments…] -> prints "block" or "allow"
verdict() {
  local cmd="$1"; shift
  local payload out rc
  payload="$(jq -nc --arg c "$cmd" --arg w "$CWD" \
    '{cwd:$w,tool_name:"Bash",tool_input:{command:$c}}')"
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
  local shown="${cmd//$'\n'/ ⏎ }"
  shown="${shown//$MAIN/\$MAIN}"; shown="${shown//$WT/\$WT}"; shown="${shown//$PLAIN/\$PLAIN}"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1)); printf '  ok   %-5s  %s\n' "$got" "$shown"
  else
    fail=$((fail + 1)); printf '  FAIL want=%s got=%s  %s\n' "$want" "$got" "$shown"
  fi
}

echo "== writes into the shared PRIMARY checkout are blocked =="
CWD="$MAIN"
expect block "sed -i s/a/b/ $MAIN/pkg/x.ts"
expect block 'sed -i "s/a/b/g" pkg/x.ts'
expect block 'sed -i -e "s/a/b/" pkg/x.ts'
expect block 'sed --in-place s/a/b/ pkg/x.ts'
expect block 'sed -ri "s/a/b/" pkg/x.ts'
expect block 'perl -pi -e "s/a/b/" pkg/x.ts'
expect block "echo x > $MAIN/README.md"
expect block 'echo x >> pkg/x.ts'
expect block 'printf hi > pkg/new.ts'
expect block 'pnpm build | tee build.log'
expect block 'tee -a notes.txt'
expect block 'cp /tmp/a.txt pkg/a.txt'
expect block 'mv /tmp/a.txt pkg/a.txt'
expect block "cp -t $MAIN/pkg /tmp/a.txt"
expect block 'rm -rf pkg/x.ts'
expect block 'touch pkg/new.ts'

echo "== reached through separators, env prefixes, absolute argv0 and cd =="
CWD="$PLAIN"
expect block "cd $MAIN && tee pkg/a.ts"
expect block "cd $MAIN; echo hi > README.md"
expect block "git status && sed -i s/a/b/ $MAIN/pkg/x.ts; pnpm test"
expect block "$(printf 'cd %s\npnpm install\nsed -i "s/a/b/" pkg/x.ts\n' "$MAIN")"
CWD="$MAIN"
expect block 'FOO=1 sed -i s/a/b/ pkg/x.ts'
expect block '/usr/bin/sed -i s/a/b/ pkg/x.ts'

echo "== the SAME writes into a linked worktree are fine =="
CWD="$WT"
expect allow "sed -i s/a/b/ $WT/pkg/x.ts"
expect allow 'sed -i "s/a/b/g" pkg/x.ts'
expect allow "echo x > $WT/README.md"
expect allow 'pnpm build | tee build.log'
expect allow 'rm -rf pkg/x.ts'
expect allow 'touch pkg/new.ts'
expect allow 'cp /tmp/a.txt pkg/a.txt'
expect allow "cd $WT && tee pkg/a.ts"

echo "== writes outside any repo are fine (/tmp, scratchpad, \$HOME dotfiles) =="
CWD="$MAIN"
expect allow 'echo x > /tmp/os-selftest-out.log'
expect allow "sed -i s/a/b/ $PLAIN/notes.md"
expect allow "tee $PLAIN/x.log"
expect allow 'echo hi > /dev/null'
expect allow "rm -rf $PLAIN/scratch"

echo "== reading the shared checkout is NEVER blocked =="
CWD="$MAIN"
expect allow "cat $MAIN/README.md"
expect allow 'cat < README.md'
expect allow "grep -rn worktree $MAIN"
expect allow "ls -la $MAIN/pkg"
expect allow "git -C $MAIN grep -n sed"
expect allow 'sed -n "1,5p" README.md'
expect allow 'sed "s/a/b/" README.md > /tmp/os-selftest-out'
expect allow "cp $MAIN/README.md /tmp/copy.md"
expect allow 'pnpm --filter @objectstack/spec test'
expect allow 'git status'

echo "== writing ABOUT the ban must not trip the ban =="
CWD="$MAIN"
expect allow 'grep -n "sed -i" .claude/'
expect allow "grep -rn \"echo x > $MAIN/README.md\" .claude/"
expect allow 'echo "never run sed -i inside the shared checkout"'
expect allow 'git grep -n "cd main && tee packages/a.ts"'
# a heredoc BODY is prose: its lines are documentation, not commands (the introducing
# line's own redirect still counts — see the block case below)
expect allow "$(printf "cat > /tmp/notes.md <<'EOF'\nsed -i 's/a/b/' %s/pkg/x.ts\necho x > %s/README.md\nEOF\n" "$MAIN" "$MAIN")"
expect block "$(printf 'cat > %s/notes.md <<EOF\nhello\nEOF\n' "$MAIN")"
expect allow 'grep -q worktree <<<"$AGENTS"'

echo "== non-ASCII codepoints are never operators; ASCII redirects still are (#10247) =="
CWD="$MAIN"
# A pure-read `node -e` whose string literal carries U+2192. Nothing is redirected: the
# arrow is a display separator. Every byte of a non-ASCII codepoint is >= 0x80 and `>` is
# 0x3e, so no arrow can ever reach operator position.
expect allow "node -e \"console.log(steps.map(st=>st.a).join(' $(printf '\xe2\x86\x92') '))\""
expect allow "echo 'build $(printf '\xe2\x86\x92') test $(printf '\xe2\x86\x92') ship'"
expect allow "grep -n '$(printf '\xe2\x9e\x9c')  API:' boot.log"          # the CLI banner glyph
expect allow "echo 'a $(printf '\xe2\x87\x92') b'"
# The negative twins: an otherwise-similar command with a REAL ASCII redirect still blocks,
# so the allow side above is widened for non-ASCII only and not for redirection at large.
expect block "node -e \"console.log(1)\" > out.log"
expect block "echo 'build $(printf '\xe2\x86\x92') ship' > steps.txt"
expect block "echo 'a $(printf '\xe2\x86\x92') b' >> pkg/x.ts"

echo "== \\\" inside a double-quoted word does not end the quote (#10247 real cause) =="
CWD="$MAIN"
# The shape from the card: an escaped \" used to close the string, after which the JS arrow
# function `st=>` put a real `>` in operator position and the guard named the JS tail that
# followed it as a write target. Pure read — must be allowed.
expect allow 'node -e "const j=require(\"./a.json\"); console.log(j.x.map(st=>st.a).join(\" - \"))"'
expect allow 'node -e "console.log(\"a\", x.map(s=>s.t))"'
expect allow 'grep -rn "he said \"sed -i\" once" .claude/'
# Negative twins: a real write is still caught even when an escaped quote precedes it.
expect block 'node -e "console.log(\"hi\")" > pkg/out.json'
expect block 'sed -i "s/\"a\"/\"b\"/" pkg/x.ts'

echo "== shapes this guard deliberately does NOT claim (documented fail-open) =="
CWD="$MAIN"
expect allow "bash -c \"sed -i s/a/b/ $MAIN/pkg/x.ts\""
expect allow 'echo pkg/x.ts | xargs sed -i s/a/b/'
expect allow 'node -e "fs.writeFileSync(\"pkg/x.ts\", \"y\")"'
expect allow 'python3 -c "open(\"pkg/x.ts\",\"w\").write(\"y\")"'
expect allow 'sed -i s/a/b/ $SOMEDIR/x.ts'
expect allow 'sed -i s/a/b/ pkg/*.ts'

echo "== escape hatch =="
CWD="$MAIN"
expect allow 'sed -i s/a/b/ pkg/x.ts' OS_ALLOW_MAIN_EDITS=1
expect allow 'echo x > README.md' OS_ALLOW_MAIN_EDITS=1

echo "== unparseable / absent payload fails open =="
for probe in '{"tool_name":"Bash","tool_input":{}}' 'not json at all' '{}'; do
  if printf '%s' "$probe" | "$hook" >/dev/null 2>&1; then
    pass=$((pass + 1)); printf '  ok   allow  (payload: %s)\n' "$probe"
  else
    fail=$((fail + 1)); printf '  FAIL should fail open  (payload: %s)\n' "$probe"
  fi
done

echo "== a relative target with no cwd in the payload fails open; absolute still lands =="
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"sed -i s/a/b/ pkg/x.ts"}}' \
  | "$hook" >/dev/null 2>&1
if [ "$?" -eq 0 ]; then
  pass=$((pass + 1)); printf '  ok   allow  (relative target, no cwd)\n'
else
  fail=$((fail + 1)); printf '  FAIL relative target with no cwd should fail open\n'
fi
printf '%s' "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"sed -i s/a/b/ $MAIN/pkg/x.ts\"}}" \
  | "$hook" >/dev/null 2>&1
if [ "$?" -eq 2 ]; then
  pass=$((pass + 1)); printf '  ok   block  (absolute target, no cwd)\n'
else
  fail=$((fail + 1)); printf '  FAIL absolute target should still be judged without cwd\n'
fi

echo "== jq-less fallback still parses command and cwd =="
nojq="$(mktemp -d)"
for b in bash env cat sed head grep git dirname basename; do
  p="$(command -v "$b")" && ln -s "$p" "$nojq/$b"
done
nojq_case() { # nojq_case <want> <cwd> <command>
  local want="$1" w="$2" c="$3" got
  printf '{"cwd":"%s","tool_name":"Bash","tool_input":{"command":"%s"}}' "$w" "$c" \
    | PATH="$nojq" "$hook" >/dev/null 2>&1
  case "$?" in 0) got=allow ;; 2) got=block ;; *) got=other ;; esac
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1)); printf '  ok   %-5s  (no jq) %s\n' "$got" "$c"
  else
    fail=$((fail + 1)); printf '  FAIL want=%s got=%s  (no jq) %s\n' "$want" "$got" "$c"
  fi
}
nojq_case block "$MAIN" 'sed -i s/a/b/ pkg/x.ts'
nojq_case allow "$WT" 'sed -i s/a/b/ pkg/x.ts'
nojq_case block "$MAIN" 'echo x > README.md'
nojq_case block "$MAIN" 'cd /tmp\ntee '"$MAIN"'/pkg/a.ts'
nojq_case allow "$MAIN" 'grep -n \"sed -i\" .claude/'
rm -rf "$nojq"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
