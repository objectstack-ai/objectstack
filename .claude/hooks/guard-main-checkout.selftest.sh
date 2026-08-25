#!/usr/bin/env bash
# Self-test for guard-main-checkout.sh — run it after touching that hook:
#
#   .claude/hooks/guard-main-checkout.selftest.sh
#
# Feeds the hook the same JSON payload shape Claude Code delivers on PreToolUse and asserts
# the block/allow verdict per case. Hermetic: it builds its OWN throwaway git repos, a linked
# worktree of each and a non-repo directory under $TMPDIR, so the matrix never depends on
# which machine or which checkout it runs from. Needs jq and git and nothing else — no
# install, no build, no network. Exit 0 = all cases hold.
#
# Companion to guard-main-checkout-bash.selftest.sh, which covers the Bash half of the same
# worktree-first pair. That matrix is mostly SHELL SPLITTING; this hook parses no shell at
# all — it reads .tool_input.file_path and makes a PATH-AND-WORKTREE decision — so these
# cases are derived from what this hook actually decides, not ported from the sibling.
#
# Fail-open by default, on purpose: the process cwd AND CLAUDE_PROJECT_DIR both default to a
# directory in no repo at all, which is the input on which this hook allows everything. A
# case that expects `block` therefore cannot pass by accident — the verdict can only have
# come from the path in the payload. Sections that need a different default say so.
#
# GUARD_MAIN_CHECKOUT_HOOK points the matrix at a scratch copy of the hook, and
# GUARD_MAIN_CHECKOUT_SETTINGS at a scratch copy of settings.json; that is how the mutation
# runs that prove these cases can fail are driven (see NON-VACUITY at the foot of this file).
# Both default to the real files, so a plain invocation checks the real hook and real wiring.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hook="${GUARD_MAIN_CHECKOUT_HOOK:-$here/guard-main-checkout.sh}"
settings="${GUARD_MAIN_CHECKOUT_SETTINGS:-$here/../settings.json}"
pass=0
fail=0
skip=0

command -v jq >/dev/null 2>&1 || { echo "selftest needs jq to build payloads" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "selftest needs git to build the fixture" >&2; exit 1; }
[ -x "$hook" ] || { echo "hook not executable: $hook" >&2; exit 1; }

# --- fixture ---------------------------------------------------------------------------
# MAIN   a shared PRIMARY checkout            WT     a linked worktree of MAIN
# SIB    a SECOND primary checkout            SIBWT  a linked worktree of SIB
# PLAIN  a directory inside no repo at all    ODD    a PRIMARY checkout whose own path
#                                                    carries a literal `worktrees` segment
tmp="$(mktemp -d)"
nojq=""
trap 'rm -rf "$tmp" ${nojq:+"$nojq"}' EXIT INT TERM
MAIN="$tmp/mainrepo"
WT="$tmp/mainrepo-task"
SIB="$tmp/siblingrepo"
SIBWT="$tmp/siblingrepo-task"
PLAIN="$tmp/plain"
ODD="$tmp/worktrees/oddrepo"
mkdir -p "$MAIN/pkg/deep" "$SIB/pkg" "$PLAIN" "$ODD/pkg"
(
  for r in "$MAIN" "$SIB" "$ODD"; do
    cd "$r" || exit 1
    git init -q .
    git config user.email selftest@example.com
    git config user.name selftest
    : > README.md
    mkdir -p pkg
    : > pkg/x.ts
    : > pkg/x.ipynb
    git add -A
    git commit -qm init
  done
  cd "$MAIN" && git worktree add -q "$WT" -b selftest-wt
  cd "$SIB" && git worktree add -q "$SIBWT" -b selftest-sib-wt
) >/dev/null 2>&1 || { echo "could not build the git fixture" >&2; exit 1; }

CWD="$PLAIN"    # the hook's PROCESS cwd for the cases that follow; reassigned per section
PROJ="$PLAIN"   # CLAUDE_PROJECT_DIR for the cases that follow; reassigned per section

short() { # short <text> -> fixture paths rendered as their variable names
  local s="$1"
  # longest paths first: $WT and $SIBWT have $MAIN and $SIB as prefixes
  s="${s//$SIBWT/\$SIBWT}"; s="${s//$WT/\$WT}"; s="${s//$SIB/\$SIB}"
  s="${s//$MAIN/\$MAIN}"; s="${s//$PLAIN/\$PLAIN}"; s="${s//$ODD/\$ODD}"
  s="${s//$tmp/\$tmp}"
  printf '%s' "$s"
}

verdict() { # verdict <payload> [env…] -> block | allow | exitN
  local payload="$1"; shift
  local rc
  ( cd "$CWD" && printf '%s' "$payload" | env CLAUDE_PROJECT_DIR="$PROJ" "$@" "$hook" >/dev/null 2>&1 )
  rc=$?
  case "$rc" in
    0) printf 'allow' ;;
    2) printf 'block' ;;
    *) printf 'exit%s' "$rc" ;;
  esac
}

check() { # check <block|allow> <label> <payload> [env…]
  local want="$1" label="$2" payload="$3"; shift 3
  local got; got="$(verdict "$payload" "$@")"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1)); printf '  ok   %-5s  %s\n' "$got" "$(short "$label")"
  else
    fail=$((fail + 1)); printf '  FAIL want=%s got=%s  %s\n' "$want" "$got" "$(short "$label")"
  fi
}

payload() { # payload <file_path> [tool_name] -> the Edit/Write payload shape
  jq -nc --arg f "$1" --arg t "${2:-Edit}" \
    '{session_id:"selftest",cwd:"/payload-cwd-must-be-ignored",tool_name:$t,
      tool_input:{file_path:$f,old_string:"a",new_string:"b"}}'
}

expect() { # expect <block|allow> <file_path> [env…] — the common case
  local want="$1" f="$2"; shift 2
  check "$want" "$f" "$(payload "$f")" "$@"
}

echo "== the core verdict: shared PRIMARY checkout is blocked =="
expect block "$MAIN/pkg/x.ts"
expect block "$MAIN/pkg/deep/y.ts"
expect block "$MAIN/README.md"          # repo ROOT: git prints a RELATIVE git-dir here
expect block "$MAIN/.changeset/x.md"
expect block "$MAIN/pkg/x.ipynb"

echo "== the SAME files inside a linked worktree are allowed =="
expect allow "$WT/pkg/x.ts"
expect allow "$WT/pkg/deep/y.ts"
expect allow "$WT/README.md"
expect allow "$WT/pkg/x.ipynb"

echo "== files in no repo at all are allowed (scratchpad, /tmp, \$HOME dotfiles) =="
expect allow "$PLAIN/notes.md"
expect allow "$PLAIN/deep/er/still.md"
expect allow "/tmp/os-selftest-scratch.log"

echo "== new files in not-yet-created directories: judged by the nearest EXISTING ancestor =="
# The hook walks up until it finds a directory that exists. Without that walk `git -C` would
# fail on the missing directory and the guard would fail open past exactly the case that
# matters most — writing a brand-new file into the shared checkout.
expect block "$MAIN/brand/new/tree/file.ts"
expect block "$MAIN/pkg/deep/brand/new/file.ts"
expect allow "$WT/brand/new/tree/file.ts"
expect allow "$PLAIN/brand/new/tree/file.ts"

echo "== the EDITED FILE's own repo decides — sibling repos are guarded from any session =="
# CLAUDE_PROJECT_DIR is pointed at the WRONG repo in every case here, so a hook that judged
# the session instead of the file would get all four backwards.
PROJ="$WT"
expect block "$SIB/pkg/x.ts"
expect block "$MAIN/pkg/x.ts"
PROJ="$MAIN"
expect allow "$SIBWT/pkg/x.ts"
expect allow "$PLAIN/notes.md"
PROJ="$SIB"
expect block "$MAIN/pkg/x.ts"
expect allow "$WT/pkg/x.ts"
PROJ="$PLAIN"

echo "== tool_name is never consulted — scoping lives in the settings.json matcher =="
# The hook decides on the path alone. Which tools reach it is the matcher's job, asserted
# in the wiring section below; these cases pin that the hook itself does not second-guess it.
for t in Edit Write NotebookEdit MultiEdit AnythingElse; do
  check block "tool_name=$t into \$MAIN"  "$(payload "$MAIN/pkg/x.ts" "$t")"
  check allow "tool_name=$t into \$WT"    "$(payload "$WT/pkg/x.ts" "$t")"
done

echo "== escape hatch: OS_ALLOW_MAIN_EDITS must be exactly 1 =="
check allow 'OS_ALLOW_MAIN_EDITS=1  into $MAIN'    "$(payload "$MAIN/pkg/x.ts")" OS_ALLOW_MAIN_EDITS=1
check allow 'OS_ALLOW_MAIN_EDITS=1  into $SIB'     "$(payload "$SIB/pkg/x.ts")"  OS_ALLOW_MAIN_EDITS=1
check block 'OS_ALLOW_MAIN_EDITS=0'                "$(payload "$MAIN/pkg/x.ts")" OS_ALLOW_MAIN_EDITS=0
check block 'OS_ALLOW_MAIN_EDITS=(empty)'          "$(payload "$MAIN/pkg/x.ts")" OS_ALLOW_MAIN_EDITS=
check block 'OS_ALLOW_MAIN_EDITS=true'             "$(payload "$MAIN/pkg/x.ts")" OS_ALLOW_MAIN_EDITS=true
check block 'OS_ALLOW_MAIN_EDITS=yes'              "$(payload "$MAIN/pkg/x.ts")" OS_ALLOW_MAIN_EDITS=yes
check block 'OS_ALLOW_MAIN_EDITS=11'               "$(payload "$MAIN/pkg/x.ts")" OS_ALLOW_MAIN_EDITS=11
check block 'OS_ALLOW_MAIN_EDITS=" 1" (padded)'    "$(payload "$MAIN/pkg/x.ts")" OS_ALLOW_MAIN_EDITS=" 1"

echo "== a payload carrying no usable path is judged by CLAUDE_PROJECT_DIR — fails CLOSED =="
# This is the branch the hook takes when it learns nothing from the payload. It is the
# opposite posture from the Bash sibling (which fails open on an unparseable command): here
# an unreadable payload on the shared checkout still BLOCKS. Safe direction, and deliberate
# — it is an explicit `else` in the hook, not a fall-through.
for probe in '{"tool_name":"Edit","tool_input":{}}' '{}' 'not json at all' '' '{"tool_input":{"file_path":""}}'; do
  PROJ="$MAIN"; check block "no usable path, CLAUDE_PROJECT_DIR=\$MAIN  [$probe]" "$probe"
  PROJ="$WT";   check allow "no usable path, CLAUDE_PROJECT_DIR=\$WT    [$probe]" "$probe"
  PROJ="$PLAIN"; check allow "no usable path, CLAUDE_PROJECT_DIR=\$PLAIN [$probe]" "$probe"
done

echo "== with CLAUDE_PROJECT_DIR unset the no-path branch falls back to the PROCESS cwd =="
nopath='{"tool_name":"Edit","tool_input":{}}'
for pair in "$MAIN:block" "$WT:allow" "$PLAIN:allow"; do
  CWD="${pair%:*}"
  ( cd "$CWD" && printf '%s' "$nopath" | env -u CLAUDE_PROJECT_DIR "$hook" >/dev/null 2>&1 )
  rc=$?; got=allow; [ "$rc" = 2 ] && got=block
  if [ "$got" = "${pair#*:}" ]; then
    pass=$((pass + 1)); printf '  ok   %-5s  no path, no CLAUDE_PROJECT_DIR, cwd=%s\n' "$got" "$(short "$CWD")"
  else
    fail=$((fail + 1)); printf '  FAIL want=%s got=%s  no path, no CLAUDE_PROJECT_DIR, cwd=%s\n' "${pair#*:}" "$got" "$(short "$CWD")"
  fi
done
CWD="$PLAIN"; PROJ="$PLAIN"

echo "== a RELATIVE file_path is judged by the PROCESS cwd; the payload's cwd field is ignored =="
rel='{"cwd":"/payload-cwd-must-be-ignored","tool_name":"Edit","tool_input":{"file_path":"pkg/x.ts"}}'
CWD="$MAIN";  check block 'relative "pkg/x.ts", process cwd=$MAIN'  "$rel"
CWD="$WT";    check allow 'relative "pkg/x.ts", process cwd=$WT'    "$rel"
CWD="$PLAIN"; check allow 'relative "pkg/x.ts", process cwd=$PLAIN' "$rel"
# and the payload's own cwd field never overrides an absolute path
CWD="$PLAIN"
check allow 'payload cwd=$MAIN, absolute path in $WT' \
  "$(jq -nc --arg f "$WT/pkg/x.ts" --arg w "$MAIN" '{cwd:$w,tool_name:"Edit",tool_input:{file_path:$f}}')"
check block 'payload cwd=$WT, absolute path in $MAIN' \
  "$(jq -nc --arg f "$MAIN/pkg/x.ts" --arg w "$WT" '{cwd:$w,tool_name:"Edit",tool_input:{file_path:$f}}')"

echo "== a submodule of the shared checkout is not a linked worktree =="
# git-dir is .git/modules/<name> there. It must not be mistaken for .git/worktrees/<name>.
if ( cd "$MAIN" && git -c protocol.file.allow=always submodule add -q "$SIB" sub ) >/dev/null 2>&1; then
  expect block "$MAIN/sub/README.md"
  expect block "$MAIN/sub/pkg/x.ts"
else
  skip=$((skip + 2)); printf '  skip        submodule fixture unavailable in this git build\n'
fi

echo "== the jq-less fallback still reaches the same verdict on real payloads =="
nojq="$(mktemp -d)"
for b in bash env cat sed head grep git dirname basename; do
  p="$(command -v "$b")" && ln -s "$p" "$nojq/$b"
done
check block 'no jq: into $MAIN'                "$(payload "$MAIN/pkg/x.ts")"    PATH="$nojq"
check allow 'no jq: into $WT'                  "$(payload "$WT/pkg/x.ts")"      PATH="$nojq"
check allow 'no jq: into $PLAIN'               "$(payload "$PLAIN/notes.md")"   PATH="$nojq"
check block 'no jq: new file, new dir in $MAIN' "$(payload "$MAIN/brand/new/f.ts")" PATH="$nojq"
mkdir -p "$MAIN/a b" "$WT/a b"
check block 'no jq: path containing a space, $MAIN' "$(payload "$MAIN/a b/c.ts")" PATH="$nojq"
check allow 'no jq: path containing a space, $WT'   "$(payload "$WT/a b/c.ts")"   PATH="$nojq"
# a decoy "file_path" inside a Write payload's content is JSON-escaped, so the text scan
# does not mistake it for the real key
decoy="$(jq -nc --arg f "$MAIN/pkg/x.ts" --arg c "see \"file_path\": \"$PLAIN/decoy\" in the docs" \
  '{tool_name:"Write",tool_input:{content:$c,file_path:$f}}')"
check block 'no jq: escaped decoy file_path in content loses to the real key' "$decoy" PATH="$nojq"
check block 'with jq: same decoy payload'                                     "$decoy"

echo "== wiring: settings.json must route Edit, Write and NotebookEdit to this hook =="
# The hook is deliberately tool-agnostic, so the matcher is the ONLY thing that decides which
# tools it sees. Nothing else in the repo checks that. Additions to the matcher are fine;
# a removal is what this pins.
if [ -f "$settings" ]; then
  matcher="$(jq -r '[.hooks.PreToolUse[]? | select([.hooks[]?.command] | join(" ") | contains("guard-main-checkout.sh"))
                     | .matcher] | join(" ")' "$settings" 2>/dev/null || printf '')"
  for tool in Edit Write NotebookEdit; do
    case "$matcher" in
      *"$tool"*) pass=$((pass + 1)); printf '  ok   wired  %s -> guard-main-checkout.sh\n' "$tool" ;;
      *) fail=$((fail + 1)); printf '  FAIL %s is not routed to guard-main-checkout.sh (matcher: %s)\n' "$tool" "$matcher" ;;
    esac
  done
else
  fail=$((fail + 1)); printf '  FAIL settings.json not found at %s\n' "$(short "$settings")"
fi

# ── KNOWN HOLES ─────────────────────────────────────────────────────────────────────────
# The cases below pin what the hook does TODAY, and what it does today is WRONG. They are
# here so the matrix says the hole out loud rather than being silent about it, and so that
# fixing it is a mechanical edit to this file. They are NOT statements of intended
# behaviour. Each names the issue that must flip it.
echo "== KNOWN HOLE #11809: any git-dir path containing /worktrees/ reads as a linked worktree =="
# `case "$gitdir" in */worktrees/*) exit 0` is a substring match on a path, not a test for a
# linked worktree. $ODD is a PRIMARY checkout that merely lives under a directory named
# `worktrees`. git prints a RELATIVE git-dir (`.git`) at a repo's toplevel and an ABSOLUTE
# one from any subdirectory, so the same unguarded checkout gets opposite verdicts by depth.
# When #11809 is fixed both of these become `block`.
# The deciding detail, measured rather than assumed: it is the NEAREST EXISTING ANCESTOR
# that is handed to git, so a path whose nearest existing ancestor is the repo toplevel gets
# the relative git-dir and blocks, while anything resolving to a subdirectory gets the
# absolute one and slips through.
expect block "$ODD/README.md"          # correct today, but only because git-dir was relative
expect block "$ODD/brand/new/f.ts"     # ditto — resolves up to the toplevel
expect allow "$ODD/pkg/x.ts"           # ⛔ WRONG — an unguarded edit into a PRIMARY checkout
expect allow "$ODD/pkg/brand/new/f.ts" # ⛔ WRONG — same hole, reached through the ancestor walk

echo "== KNOWN HOLE #11810: NotebookEdit's path key is notebook_path, which this hook never reads =="
# The matcher routes NotebookEdit here, but the hook extracts only .tool_input.file_path, so
# every notebook edit takes the no-path branch and is judged by CLAUDE_PROJECT_DIR instead of
# by the file. The verdict below is a constant per session and is wrong in both directions.
# When #11810 is fixed, these become block / allow / allow by the notebook's own path.
nbpay() { jq -nc --arg f "$1" '{tool_name:"NotebookEdit",tool_input:{notebook_path:$f,new_source:"x",edit_mode:"replace"}}'; }
PROJ="$MAIN"
check block 'NotebookEdit into $MAIN,  CLAUDE_PROJECT_DIR=$MAIN'  "$(nbpay "$MAIN/pkg/x.ipynb")"
check block 'NotebookEdit into $WT,    CLAUDE_PROJECT_DIR=$MAIN'  "$(nbpay "$WT/pkg/x.ipynb")"   # ⛔ WRONG — refuses the mandated location
check block 'NotebookEdit into $PLAIN, CLAUDE_PROJECT_DIR=$MAIN'  "$(nbpay "$PLAIN/x.ipynb")"    # ⛔ WRONG — refuses a file in no repo
PROJ="$WT"
check allow 'NotebookEdit into $MAIN,  CLAUDE_PROJECT_DIR=$WT'    "$(nbpay "$MAIN/pkg/x.ipynb")" # ⛔ WRONG — unguarded edit into the shared checkout
PROJ="$PLAIN"
check allow 'NotebookEdit into $MAIN,  CLAUDE_PROJECT_DIR=$PLAIN' "$(nbpay "$MAIN/pkg/x.ipynb")" # ⛔ WRONG — same, from a session rooted outside any repo

echo "== BOUNDARY: the jq-less fallback is a text scan, not a JSON parser =="
# Not filed as a defect: jq is present wherever this hook runs, and Claude Code emits plain
# UTF-8 paths, never \u-escaped ones. Recorded so that the first thing to fix is known if the
# fallback ever becomes load-bearing. With jq the same payload is judged correctly.
esc="$(printf '%s' "$MAIN/pkg/x.ts" | sed 's/\//\\u002f/g')"
uni="$(printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$esc")"
check block 'with jq: /-escaped path into $MAIN'  "$uni"
check allow 'no jq: /-escaped path yields no path' "$uni" PATH="$nojq"

printf '\n%s passed, %s failed' "$pass" "$fail"
[ "$skip" -gt 0 ] && printf ', %s skipped' "$skip"
printf '\n'
[ "$fail" -eq 0 ]

# ── NON-VACUITY ─────────────────────────────────────────────────────────────────────────
# Each class above was shown to fail against a mutated copy of the hook before being trusted
# to pass against the real one. Reproduce any of them without touching the real hook:
#
#   cp .claude/hooks/guard-main-checkout.sh /tmp/mutant.sh
#   # e.g. delete the linked-worktree escape, which should redden every `allow` in a worktree:
#   perl -0pi -e 's{^\s*\*/worktrees/\*\) exit 0 ;;\n}{}m' /tmp/mutant.sh
#   GUARD_MAIN_CHECKOUT_HOOK=/tmp/mutant.sh .claude/hooks/guard-main-checkout.selftest.sh
#
# The mutations used, one per class: drop the */worktrees/* arm (core verdict) · drop the
# nearest-existing-ancestor walk (new-file class) · replace dirname "$file" with
# CLAUDE_PROJECT_DIR (the file's-own-repo class) · drop the OS_ALLOW_MAIN_EDITS line (escape
# hatch) · turn the no-path else branch into exit 0 (the fails-closed class) · rename the key
# in the grep fallback (the jq-less class) · change the final exit 2 to exit 0 (every block).
