#!/usr/bin/env bash
# Self-test for guard-governed-enqueue.sh — run it after touching that hook:
#
#   .claude/hooks/guard-governed-enqueue.selftest.sh
#
# Feeds the hook the same JSON payload shape Claude Code delivers on PreToolUse
# and asserts the block/allow verdict per case, plus the load-bearing sentences
# of the refusal. Modelled on guard-shared-stash.selftest.sh; the two matrices
# are kept in the same shape so neither drifts into its own idiom.
#
# NO NETWORK. The three GitHub reads come from `OS_GOVERNED_ENQUEUE_FIXTURE`
# (documented in the hook's header as test-only injection): a directory holding
# `pull.json` / `files.json` / `reviews.json`. What is NOT stubbed is the part
# that matters — both predicates run for real, so this matrix fails if the hook
# ever stops asking the register and the queue guard and starts deciding for
# itself.
#
# Needs `jq` (to build fixtures) and `node` (the two real predicates run). No
# pnpm install, no build: measured against a worktree with no `node_modules`.
#
# ⚠️ THE PURE-REGENERATION CASE IS AN AGREEMENT ASSERTION, NOT A FIXED VERDICT,
# and that is a repair rather than a preference: the first revision of this file
# hard-coded `expect allow` against the one exception row that was cheap to
# lift, and that row was retired upstream hours later — the case then went red
# over a register change the hook had nothing to do with. Copying a verdict out
# of the register makes this matrix a second register. It now ASKS the register
# and requires the hook to answer the same way; see that block for the detail.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hook="$here/guard-governed-enqueue.sh"
repo_root="$(cd "$here/../.." && pwd)"
pass=0
fail=0

command -v jq >/dev/null 2>&1 || { echo "selftest needs jq to build payloads" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "selftest needs node: both predicates run for real" >&2; exit 1; }
[ -x "$hook" ] || { echo "hook is not executable: $hook" >&2; exit 1; }

HEAD_SHA=b25f061c6a1d4e2f3c9b8a7d6e5f4a3b2c1d0e9f
OLD_SHA=0f9e8d7c6b5a4938271605f4e3d2c1b0a98877665

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT INT TERM

# fixture <name> <files-json> <reviews-json> -> prints the directory
fixture() {
  local dir="$root/$1"
  mkdir -p "$dir"
  jq -nc --arg s "$HEAD_SHA" '{head:{sha:$s}}' > "$dir/pull.json"
  printf '%s' "$2" > "$dir/files.json"
  printf '%s' "$3" > "$dir/reviews.json"
  printf '%s' "$dir"
}

files_of() { # files_of path... -> the /pulls/{n}/files body shape
  local out="[]" p
  for p in "$@"; do out="$(printf '%s' "$out" | jq -c --arg f "$p" '. + [{filename:$f}]')"; done
  printf '%s' "$out"
}

approved_at() { # approved_at <login> <sha>
  jq -nc --arg l "$1" --arg c "$2" '[{state:"APPROVED",user:{login:$l},commit_id:$c}]'
}

NO_REVIEWS='[]'
GOVERNED_FILES="$(files_of AGENTS.md packages/spec/src/index.ts)"
CLEAR_FILES="$(files_of packages/spec/src/index.ts README.md)"
# The incident's own file class, and four of them, the way it actually happened:
# `skills/*/references/_index.md` is a governed `skills/**` path whose generator
# (`gen:skill-refs`) owns it, so a byte-exact regeneration is lifted and needs no
# approval at all. Every path here must be one the generator DECLARES — a skill
# absent from its map is hand-authored content that stays governed, which is the
# ruling's own limit and not a bug to route around.
REGEN_PATHS="skills/objectstack-data/references/_index.md skills/objectstack-query/references/_index.md skills/objectstack-ui/references/_index.md skills/objectstack-api/references/_index.md"
# shellcheck disable=SC2086
REGEN_FILES="$(files_of $REGEN_PATHS)"

F_UNAPPROVED="$(fixture governed-unapproved "$GOVERNED_FILES" "$NO_REVIEWS")"
F_PINNED="$(fixture governed-pinned "$GOVERNED_FILES" "$(approved_at os-zhuang "$HEAD_SHA")")"
F_STALE="$(fixture governed-stale "$GOVERNED_FILES" "$(approved_at os-zhuang "$OLD_SHA")")"
F_OUTSIDER="$(fixture governed-outsider "$GOVERNED_FILES" "$(approved_at os-warren "$HEAD_SHA")")"
F_DISMISSED="$(fixture governed-dismissed "$GOVERNED_FILES" \
  "$(jq -nc --arg c "$HEAD_SHA" '[{state:"APPROVED",user:{login:"os-zhuang"},commit_id:$c},{state:"DISMISSED",user:{login:"os-zhuang"},commit_id:$c}]')")"
F_CLEAR="$(fixture not-governed "$CLEAR_FILES" "$NO_REVIEWS")"
F_REGEN="$(fixture pure-regeneration "$REGEN_FILES" "$NO_REVIEWS")"
F_EMPTY="$(fixture empty-diff '[]' "$NO_REVIEWS")"

mcp() { # mcp <tool> <pull> [owner] [repo]
  jq -nc --arg t "$1" --argjson n "$2" --arg o "${3:-objectstack-ai}" --arg r "${4:-objectstack}" \
    '{tool_name:$t,tool_input:{owner:$o,repo:$r,pullNumber:$n}}'
}
bash_call() { jq -nc --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}'; }

AUTO=mcp__github__enable_pr_auto_merge
MERGE=mcp__github__merge_pull_request

# The hook is the LAST element of the pipeline, so `$?` here is the HOOK's exit
# status and not some downstream reader's. That is the only shape in which
# reading a status after a pipe is safe, and it is why nothing is piped past it.
run() { # run <payload> [env assignments…] -> allow | block | exitN
  local payload="$1"; shift
  local rc
  printf '%s' "$payload" | env "$@" "$hook" >/dev/null 2>&1
  rc=$?
  case "$rc" in
    0) printf 'allow' ;;
    2) printf 'block' ;;
    *) printf 'exit%s' "$rc" ;;
  esac
}

stderr_of() { # stderr_of <payload> [env…]
  local payload="$1"; shift
  printf '%s' "$payload" | env "$@" "$hook" 2>&1 >/dev/null
}

expect() { # expect <block|allow> <label> <payload> [env…]
  local want="$1" label="$2" payload="$3"; shift 3
  local got; got="$(run "$payload" "$@")"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1)); printf '  ok   %-5s  %s\n' "$got" "$label"
  else
    fail=$((fail + 1)); printf '  FAIL want=%s got=%s  %s\n' "$want" "$got" "$label"
  fi
}

expect_says() { # expect_says <needle> <label> <payload> [env…]
  local needle="$1" label="$2" payload="$3"; shift 3
  local out; out="$(stderr_of "$payload" "$@")"
  case "$out" in
    *"$needle"*) pass=$((pass + 1)); printf '  ok   says   %s\n' "$label" ;;
    *) fail=$((fail + 1)); printf '  FAIL missing "%s"  %s\n' "$needle" "$label" ;;
  esac
}

echo "== the incident's own shape: governed + no approval at all =="
expect block 'enable_pr_auto_merge on a governed PR with zero reviews' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect block 'merge_pull_request on a governed PR with zero reviews' \
  "$(mcp $MERGE 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"

echo "== the refusal carries its one-line reason and its remedy =="
expect_says 'approve BEFORE enqueue' 'the order is stated' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect_says 'does NOT re-run on a later approval' 'the no-re-run reason is stated' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect_says 'OS_ALLOW_GOVERNED_ENQUEUE=1' 'the deliberate exception is named' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect_says "$HEAD_SHA" 'the head sha the approval must pin is named' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect_says 'AGENTS.md' 'the governed hit is named' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"

echo "== an AUTHORIZED approval PINNED to the current head is the pass =="
expect allow 'governed + os-zhuang APPROVED at the current head' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_PINNED"

echo "== the three ways an approval does not count (pinnedApprovalVerdict, imported) =="
expect block 'a STALE approval (approved an earlier head) never counts' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_STALE"
expect block 'an APPROVED review from outside GOVERNED_APPROVERS never counts' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_OUTSIDER"
expect block 'a later DISMISSED supersedes the same reviewer approval' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_DISMISSED"
expect_says 'STALE approval' 'a stale approval is reported as stale, not as absent' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_STALE"
expect_says 'outside the authorized set' 'an unauthorized approval is reported as such' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_OUTSIDER"

echo "== nothing governed in the diff: allowed, and no review is ever consulted =="
expect allow 'an ordinary diff enqueues freely' \
  "$(mcp $AUTO 14070)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_CLEAR"

echo "== PURE REGENERATION: the hook must AGREE with the register, never re-decide =="
# The requirement (maintainer 2026-09-01: 纯生成的指针行 … 不需要我审核吧) is that
# this hook never re-closes a zero-approval path the register clears. Pinned
# against a REAL exception-row candidate, and pinned as AGREEMENT rather than as
# a fixed verdict, for a reason this matrix learned the hard way: an earlier
# revision hard-coded `expect allow` on the one row that was cheap to lift, that
# row was RETIRED upstream the same day (its surface left the governed fence
# entirely), and the case then failed for a reason that had nothing to do with
# the hook. A verdict copied from the register is a second register.
#
# So: ask the register what it says about this path list on THIS tree, and
# require the hook to answer the same way.
#   exit 0 => lifted (the generator toolchain is present and the bytes match)
#             => the hook MUST allow with zero reviews. This is the branch CI
#                takes, where dependencies are installed.
#   exit 3 => not lifted (fail-closed: no toolchain, or a hand edit)
#             => the hook MUST refuse, exactly as the register asked.
# Either way the property under test holds: the hook contributes no judgment of
# its own about the exemption.
# shellcheck disable=SC2086
node "$repo_root/scripts/pm/check-governed-merges.mjs" --test $REGEN_PATHS >/dev/null 2>&1
regen_rc=$?
if [ "$regen_rc" -eq 0 ]; then
  regen_want=allow
  regen_branch='LIFTED — byte-exact regeneration, so zero approvals must pass (the toolchain is present here)'
else
  regen_want=block
  regen_branch="NOT lifted (exit $regen_rc, fail-closed: no generator toolchain, or a hand edit) — the refusal must stand"
fi
printf '  ..   register verdict on the four %s: %s\n' 'skills/*/references/_index.md' "$regen_branch"
expect "$regen_want" 'the hook agrees with the register about an exception-row candidate' \
  "$(mcp $AUTO 14070)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_REGEN"

# ...and the structural half, which no fixture can go stale on: the ONLY branch
# that can reach a refusal is the register's own "governed" exit code. Anything
# the register clears leaves through `exit 0` before a single review is read.
if grep -qE '^[[:space:]]*0\)[[:space:]]*exit 0' "$hook"; then
  pass=$((pass + 1)); printf '  ok   wired  a cleared predicate verdict exits before any review is read\n'
else
  fail=$((fail + 1)); printf '  FAIL the hook no longer allows unconditionally on a cleared predicate verdict\n'
fi

echo "== the Bash spellings reach the same decision =="
expect block 'gh pr merge <n> -R owner/repo' \
  "$(bash_call 'gh pr merge 13794 -R objectstack-ai/objectstack --squash')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect block 'gh pr merge --auto --repo=owner/repo <n>' \
  "$(bash_call 'gh pr merge --auto --repo=objectstack-ai/objectstack 13794')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect block 'gh pr merge <html url>' \
  "$(bash_call 'gh pr merge https://github.com/objectstack-ai/objectstack/pull/13794 --squash')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect block 'a REST PUT .../pulls/<n>/merge through curl' \
  "$(bash_call 'curl -sS -X PUT https://api.github.com/repos/objectstack-ai/objectstack/pulls/13794/merge -d "{}"')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect block 'gh api -X PUT /repos/o/r/pulls/<n>/merge' \
  "$(bash_call 'gh api -X PUT /repos/objectstack-ai/objectstack/pulls/13794/merge')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect block 'reached through a separator' \
  "$(bash_call 'git fetch origin main && gh pr merge 13794 -R objectstack-ai/objectstack')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect allow 'the same Bash spelling on an approved PR' \
  "$(bash_call 'gh pr merge 13794 -R objectstack-ai/objectstack')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_PINNED"

echo "== an UNQUOTED \\\" opens no quote, so the merge behind it is still seen =="
# The #11738 class, carried by all three Bash-reading guards in this directory:
# segmentation used to read the escaped `\"` as OPENING a region that never
# closed, every separator behind it went inert, and the real command rode
# through as an argument of something harmless.
expect block 'echo \" ; gh pr merge <n>' \
  "$(bash_call 'echo \" ; gh pr merge 13794 -R objectstack-ai/objectstack')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect allow 'echo \" ; git status  (precision twin: no manufactured block)' \
  "$(bash_call 'echo \" ; git status')" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"

echo "== writing ABOUT the ban must not trip the ban =="
expect allow 'grep -n "gh pr merge" AGENTS.md' \
  "$(bash_call 'grep -n "gh pr merge" AGENTS.md')" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect allow 'echo "never gh pr merge a governed PR"' \
  "$(bash_call 'echo "never gh pr merge a governed PR"')" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"

echo "== unrelated tools and commands are untouched =="
expect allow 'a Bash command that enqueues nothing' \
  "$(bash_call 'pnpm --filter @objectstack/spec test')" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect allow 'a non-enqueue MCP tool' \
  "$(jq -nc '{tool_name:"mcp__github__create_pull_request",tool_input:{owner:"objectstack-ai",repo:"objectstack",draft:true}}')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect allow 'an Edit call' \
  "$(jq -nc '{tool_name:"Edit",tool_input:{file_path:"AGENTS.md"}}')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"

echo "== parse-confidently-or-allow =="
expect allow 'a payload with no tool_name at all' '{}' "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect allow 'an empty payload' '' "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect allow 'an enqueue call naming no pull number' \
  "$(jq -nc --arg t "$AUTO" '{tool_name:$t,tool_input:{owner:"objectstack-ai",repo:"objectstack"}}')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect allow 'a non-numeric pull number' \
  "$(jq -nc --arg t "$AUTO" '{tool_name:$t,tool_input:{owner:"objectstack-ai",repo:"objectstack",pullNumber:"nope"}}')" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect allow 'gh pr merge on the CURRENT branch (the PR is not named)' \
  "$(bash_call 'gh pr merge --auto --squash')" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect_says 'names no pull request' 'the unidentifiable form says why it was allowed' \
  "$(bash_call 'gh pr merge --auto --squash')" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"

echo "== FAIL-OPEN on a read failure, with the reason on stderr =="
expect allow 'the API cannot be read at all' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED" OS_GOVERNED_ENQUEUE_READFAIL=1
expect_says 'ALLOWING' 'the fail-open says it is allowing' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED" OS_GOVERNED_ENQUEUE_READFAIL=1
expect_says 'merge-queue guard remains the hard line' 'the fail-open names where correctness still lives' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED" OS_GOVERNED_ENQUEUE_READFAIL=1
expect allow 'a PR reporting no changed files is not a governed answer' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_EMPTY"

echo "== a generated-exception row on a repo with no checkout to recompute against =="
# objectstack-ai/cloud has no sibling checkout here, so the register cannot
# recompute the row's provenance on the RIGHT tree. Judging one repo's paths
# against another's files would be worse than not answering: fail open, say so.
expect allow 'an exception-row path in a repo this container cannot resolve' \
  "$(mcp $AUTO 999 objectstack-ai cloud)" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$(fixture cross-repo-regen "$(files_of skills/objectstack-data/references/_index.md)" "$NO_REVIEWS")"

echo "== the deliberate exception switch =="
expect allow 'OS_ALLOW_GOVERNED_ENQUEUE=1 on the blocking case' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED" OS_ALLOW_GOVERNED_ENQUEUE=1

echo "== the jq-less fallback still identifies the call and still refuses =="
nojq="$(mktemp -d)"
# Every external the hook reaches for, MINUS jq. A missing one here reads as a
# fail-open ("could not read …"), which is the hook behaving correctly on a
# broken PATH — so keep this list complete or the case tests the harness.
for b in bash env cat sed head tail grep printf node git curl mktemp rm tr cut wc dirname; do
  p="$(command -v "$b")" && ln -s "$p" "$nojq/$b" 2>/dev/null
done
printf '%s' "$(mcp $AUTO 13794)" \
  | env "PATH=$nojq" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED" "$hook" >/dev/null 2>&1
case "$?" in
  2) pass=$((pass + 1)); printf '  ok   block  (no jq on PATH)\n' ;;
  0) fail=$((fail + 1)); printf '  FAIL no-jq fallback ALLOWED a governed unapproved enqueue\n' ;;
  *) fail=$((fail + 1)); printf '  FAIL no-jq fallback exit%s\n' "$?" ;;
esac
rm -rf "$nojq"

echo "== the two predicates are the imported ones, not a local copy =="
# A restatement of either predicate inside the hook is the failure this asserts
# against: grep the hook for a second path list or a second approver list.
if grep -q 'check-governed-merges.mjs' "$hook" && grep -q 'pinnedApprovalVerdict' "$hook"; then
  pass=$((pass + 1)); printf '  ok   wired  both single sources are invoked by name\n'
else
  fail=$((fail + 1)); printf '  FAIL the hook no longer invokes both single sources\n'
fi
if grep -qE "os-zhuang|hotlong" "$hook"; then
  fail=$((fail + 1)); printf '  FAIL the hook spells out an approver login: GOVERNED_APPROVERS is the single source\n'
else
  pass=$((pass + 1)); printf '  ok   wired  no approver login is spelled out in the hook\n'
fi
if grep -vE '^[[:space:]]*#' "$hook" | grep -qE 'AGENTS\.md|CLAUDE\.md|skills/|docs/adr/'; then
  fail=$((fail + 1)); printf '  FAIL a governed-surface path literal appears in the hook CODE: that is a second register\n'
else
  pass=$((pass + 1)); printf '  ok   wired  no governed-path literal outside the header comments\n'
fi

echo "== the hook is registered where Claude Code will actually run it =="
settings="$repo_root/.claude/settings.json"
if [ -f "$settings" ] && grep -q 'guard-governed-enqueue.sh' "$settings"; then
  pass=$((pass + 1)); printf '  ok   wired  .claude/settings.json registers the hook\n'
else
  fail=$((fail + 1)); printf '  FAIL .claude/settings.json does not register the hook — it would guard nothing\n'
fi
for m in mcp__github__enable_pr_auto_merge mcp__github__merge_pull_request; do
  if [ -f "$settings" ] && grep -q "$m" "$settings"; then
    pass=$((pass + 1)); printf '  ok   wired  matcher covers %s\n' "$m"
  else
    fail=$((fail + 1)); printf '  FAIL no PreToolUse matcher covers %s\n' "$m"
  fi
done

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
