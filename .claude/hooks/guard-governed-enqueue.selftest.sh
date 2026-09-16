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
# The hook `run`/`stderr_of` actually invoke. It is `$hook` for every case but
# one: the bare `gh pr merge <n>` case asks the hook about a DIFFERENT checkout's
# origin, and the hook derives its repo root from its own path, so that case runs
# a copy sitting in a checkout it built — and restores this on the next line.
hook_under_test="$hook"
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

# A RENAME is the one entry shape `files_of` cannot build: every other status
# carries `filename` alone, a renamed one ALSO carries `previous_filename`.
# Measured on PR #17372 (`GET /pulls/17372/files`): `filename` is the NEW path,
# `previous_filename` the OLD one. `files_of` keeps its shape; this is the twin.
renamed_of() { # renamed_of <old path> <new path> -> the /files body for one RENAME
  jq -nc --arg o "$1" --arg n "$2" '[{filename:$n,previous_filename:$o,status:"renamed"}]'
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
F_OLDER="$(fixture governed-approved-on-an-earlier-commit "$GOVERNED_FILES" "$(approved_at os-zhuang "$OLD_SHA")")"
F_OUTSIDER="$(fixture governed-outsider "$GOVERNED_FILES" "$(approved_at os-warren "$HEAD_SHA")")"
F_DISMISSED="$(fixture governed-dismissed "$GOVERNED_FILES" \
  "$(jq -nc --arg c "$HEAD_SHA" '[{state:"APPROVED",user:{login:"os-zhuang"},commit_id:$c},{state:"DISMISSED",user:{login:"os-zhuang"},commit_id:$c}]')")"
F_CLEAR="$(fixture not-governed "$CLEAR_FILES" "$NO_REVIEWS")"
F_REGEN="$(fixture pure-regeneration "$REGEN_FILES" "$NO_REVIEWS")"
F_EMPTY="$(fixture empty-diff '[]' "$NO_REVIEWS")"
F_RENAMED_OFF="$(fixture governed-renamed-off-the-surface "$(renamed_of AGENTS.md docs/AGENTS.md)" "$NO_REVIEWS")"
F_RENAMED_CLEAR="$(fixture rename-within-an-ordinary-prefix "$(renamed_of packages/spec/src/a.ts packages/spec/src/b.ts)" "$NO_REVIEWS")"

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
  printf '%s' "$payload" | env "$@" "$hook_under_test" >/dev/null 2>&1
  rc=$?
  case "$rc" in
    0) printf 'allow' ;;
    2) printf 'block' ;;
    *) printf 'exit%s' "$rc" ;;
  esac
}

stderr_of() { # stderr_of <payload> [env…]
  local payload="$1"; shift
  printf '%s' "$payload" | env "$@" "$hook_under_test" 2>&1 >/dev/null
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

# The other direction, and it earns its place: a retired RULE leaves its
# sentence behind in the text a seat actually reads, long after the predicate
# stopped enforcing it. `expect_says` cannot catch that — only an assertion that
# a phrase is ABSENT can.
expect_lacks() { # expect_lacks <needle> <label> <payload> [env…]
  local needle="$1" label="$2" payload="$3"; shift 3
  local out; out="$(stderr_of "$payload" "$@")"
  case "$out" in
    *"$needle"*) fail=$((fail + 1)); printf '  FAIL still says "%s"  %s\n' "$needle" "$label" ;;
    *) pass=$((pass + 1)); printf '  ok   lacks  %s\n' "$label" ;;
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
# …and it names WHERE that variable has to be set. A VAR=1 prefix sets the variable in the
# environment of THAT COMMAND; this hook is not that command, and it reads its own
# environment, so a prefix never reaches it (#15971). The `lacks` row is the shape shared
# with the other four matrices, where the dead prefix remedy was actually printed.
expect_lacks 're-run with' 'no prefix remedy is offered for the exception' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect_says 'hook itself runs in' 'the exception names the environment this hook reads' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect_says "$HEAD_SHA" 'the current head sha is named so the reader knows which PR state this is' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect_says 'does NOT have to sit on the' 'the remedy states the 2026-09-04 predicate, not the retired sha pin' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect_lacks 'unpins it' 'the retired advice (a push unpins the approval) is gone from the refusal' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect_says 'AGENTS.md' 'the governed hit is named' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"

echo "== an AUTHORIZED APPROVED review is the pass, on the head or on any commit =="
expect allow 'governed + os-zhuang APPROVED at the current head' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_PINNED"
# ⭐ 2026-09-04, verbatim: 只需要有人工批准记录就行，不需要卡最新的提交。 Under the
# retired sha pin this SAME fixture was the block case, which is exactly why it
# is pinned in the ruled direction here rather than deleted. The hook holds no
# predicate of its own, so this direction arrives entirely through the imported
# `authorizedApprovalVerdict` — flipping it back there flips this case red.
expect allow 'governed + os-zhuang APPROVED on an EARLIER commit still counts' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_OLDER"

echo "== the two ways an approval does not count (authorizedApprovalVerdict, imported) =="
expect block 'an APPROVED review from outside GOVERNED_APPROVERS never counts' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_OUTSIDER"
expect block 'a later DISMISSED supersedes the same reviewer approval' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_DISMISSED"
expect_says 'outside the authorized set' 'an unauthorized approval is reported as such' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_OUTSIDER"

echo "== nothing governed in the diff: allowed, and no review is ever consulted =="
expect allow 'an ordinary diff enqueues freely' \
  "$(mcp $AUTO 14070)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_CLEAR"

echo "== a RENAME is a change to BOTH paths, so the OLD one is read too =="
# Read `filename` alone and the old path is simply absent from the list handed to
# the register — and a dropped path can only REMOVE governance, never add it, so
# a diff that moves AGENTS.md to docs/AGENTS.md would read here as an ordinary
# one. The other two readers of the same diff already see both paths (the queue
# guard decomposes per commit with `--no-renames`, and `--pr` derives the list
# three-dot), so this is the hook catching up to them, not a new predicate.
expect block 'a governed file renamed OFF the governed surface is still governed' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_RENAMED_OFF"
expect_says 'AGENTS.md' 'the OLD path is the governed hit the refusal names' \
  "$(mcp $AUTO 13794)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_RENAMED_OFF"
expect allow 'a rename inside a non-governed prefix changes no verdict' \
  "$(mcp $AUTO 14070)" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_RENAMED_CLEAR"

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

echo "== a bare \`gh pr merge <n>\` derives the slug from the checkout's OWN origin =="
# The second half of this card's defect, and the expensive half: with no `-R` the
# target repo comes from the checkout's `origin`, so a `.git` suffix left on the
# slug rides into the API URL — `GET /repos/objectstack-ai/objectstack.git/pulls/N`
# answers 404 and this guard's read-failure branch ALLOWS. On any clone made with
# the URL `git clone` hands out by default, that spelling was unguarded.
#
# The checkout is BUILT here: the hook derives its repo root from its own path
# (`BASH_SOURCE`), so the only way to ask it about another origin is to run a copy
# that sits in one. `.claude/hooks/` and `scripts/` are symlinked back at this
# tree, so both predicates are the same files, running the same way.
#
# ⛔ The allow/block verdict is deliberately NOT asserted here, and that is
# measured rather than cautious: `OS_GOVERNED_ENQUEUE_FIXTURE` answers EVERY path,
# so the 404 that makes the real guard fail open cannot be reproduced without the
# network — under the fixture the wrong slug blocks exactly like the right one,
# and a verdict row here would pass in both worlds. What discriminates is the slug
# itself, which the refusal prints as `<owner>/<repo>#<n>`: it read
# `objectstack-ai/objectstack.git#13794` until `slug_of` stripped the suffix.
DOTGIT_CLONE="$root/dotgit-url-clone"     # under $root: the existing trap removes it
mkdir -p "$DOTGIT_CLONE/.claude/hooks"
ln -s "$hook" "$DOTGIT_CLONE/.claude/hooks/guard-governed-enqueue.sh"
ln -s "$repo_root/scripts" "$DOTGIT_CLONE/scripts"
git -C "$DOTGIT_CLONE" init -q >/dev/null 2>&1
git -C "$DOTGIT_CLONE" remote add origin https://github.com/objectstack-ai/objectstack.git >/dev/null 2>&1
hook_under_test="$DOTGIT_CLONE/.claude/hooks/guard-governed-enqueue.sh"
expect_says 'objectstack-ai/objectstack#13794' 'the slug the guard reads is the one the API answers for' \
  "$(bash_call 'gh pr merge 13794 --squash')" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
expect_lacks 'objectstack.git' 'no .git suffix rides into the repo path the guard reads' \
  "$(bash_call 'gh pr merge 13794 --squash')" "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNAPPROVED"
hook_under_test="$hook"                   # every case below is back on the real hook

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
# With no checkout of the target repo the register cannot recompute the row's
# provenance on the RIGHT tree, and judging one repo's paths against another's
# files would be worse than not answering: fail open, say so.
#
# ⚠️ THIS CASE'S PREMISE IS INJECTED, AND THE INJECTION IS THE REPAIR. It used to
# rest on a fact about the BOX — "objectstack-ai/cloud has no sibling checkout
# here" — which is a property of the container, not of the hook, and not true
# everywhere: on a box that does carry a sibling `cloud` checkout the guard
# resolved it, recomputed the predicate on it and BLOCKED, so this matrix read
# `54 passed, 1 failed` there and was green in CI only because the runner
# mounts no sibling. A case whose verdict depends on what else happens to sit
# next to the checkout is not hermetic, whatever the step comment says. It now
# points the lookup at a directory it created itself and therefore knows is
# empty, so the "cannot resolve" premise is one this file OWNS on every box.
# ONE spelling of the path, read by the fixture the hook is handed AND by the
# register leg below. Two spellings drift: change the fixture alone and the
# agreement leg goes on asking about the old path, which is agreement with a
# question nobody asked.
CROSS_REPO_PATH=skills/objectstack-data/references/_index.md
F_CROSS_REGEN="$(fixture cross-repo-regen "$(files_of "$CROSS_REPO_PATH")" "$NO_REVIEWS")"
NO_SIBLING_ROOT="$root/no-sibling-here"   # under $root: the existing trap removes it
mkdir -p "$NO_SIBLING_ROOT"
#
# ⚠️ AND IT DOES NOT REACH THE "no checkout … is available" FAIL-OPEN — measured,
# because the comment that used to sit here said it did. With nothing resolved
# the register is asked WITHOUT `--root`, so it answers about THIS tree, where
# this path is byte-exact against its own generator and therefore LIFTED: the
# hook leaves at the cleared-predicate `exit 0` with EMPTY stderr, several
# branches above that fail-open. Pinning a warning here would pin a sentence
# nothing prints. What this case does hold is the property the card is about —
# the verdict must not depend on what else is mounted beside the checkout — and
# the resolved-sibling case below is its other half: same fixture, same payload,
# only the injected root differs.
expect allow 'an exception-row path in a repo this container cannot resolve' \
  "$(mcp $AUTO 999 objectstack-ai cloud)" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_CROSS_REGEN" "OS_GOVERNED_ENQUEUE_SIBLING_ROOT=$NO_SIBLING_ROOT"

echo "== ...and a sibling checkout that DOES resolve is audited on its own tree =="
# The other half of that same branch, and the reason the case above needs an
# injection rather than a rename: when a checkout of the target repo IS
# reachable, resolving it and recomputing the predicate there is the DESIGNED
# behaviour — the answer then reflects the DIFF instead of the environment,
# which is the whole point of passing `--root`. Pin only the fail-open and the
# guard stays green after it stops looking for siblings at all.
#
# The sibling is BUILT here rather than borrowed from the box: `git init` plus an
# `origin` naming objectstack-ai/cloud is the entire admission requirement, since
# the hook compares origin slugs and reads nothing else. Measured on a container
# carrying the real read-only /home/user/cloud checkout: this throwaway and that
# checkout hand the register the SAME verdict with the SAME reason — governed,
# `pureRegeneration: false`, "the generator declared no output set … fail closed"
# — because the `gen:skill-refs` toolchain cannot run on either tree. The
# throwaway reproduces the real sibling, so no further tree is needed.
#
# ⛔ The origin URL is the BARE form on purpose — do not "tidy" a `.git` suffix
# onto it. The hook's slug reader keeps that suffix (its path character class
# owns the dot and swallows it, leaving `cloud.git`), so the `.git` spelling
# resolves NOTHING and this case would silently become a second copy of the one
# above. Measured here; filed separately as its own defect, since the same
# reader also derives the slug for a bare `gh pr merge <n>`.
#
# ⭐ Asserted as AGREEMENT with the register, for the reason the pure-regeneration
# case above learned the hard way: `skills/**` leaving the governed fence, or this
# exception row being retired, would flip the verdict for a reason the hook had
# nothing to do with, and a verdict copied from the register makes this matrix a
# second register. Here and in CI today that branch is `block`.
SIBLING_ROOT="$root/sibling-parent"       # under $root: the existing trap removes it
mkdir -p "$SIBLING_ROOT/cloud"
git -C "$SIBLING_ROOT/cloud" init -q >/dev/null 2>&1
git -C "$SIBLING_ROOT/cloud" remote add origin https://github.com/objectstack-ai/cloud >/dev/null 2>&1
node "$repo_root/scripts/pm/check-governed-merges.mjs" --test --root "$SIBLING_ROOT/cloud" \
  "$CROSS_REPO_PATH" >/dev/null 2>&1
sibling_rc=$?
if [ "$sibling_rc" -eq 0 ]; then
  sibling_want=allow
  sibling_branch='LIFTED on the sibling tree — the hook must answer the same way'
else
  sibling_want=block
  sibling_branch="GOVERNED on the sibling tree (exit $sibling_rc, fail-closed: the generator cannot run there) — the refusal must stand"
fi
printf '  ..   register verdict on the RESOLVED sibling: %s\n' "$sibling_branch"
expect "$sibling_want" 'a sibling checkout that resolves is audited, never waved through' \
  "$(mcp $AUTO 999 objectstack-ai cloud)" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_CROSS_REGEN" "OS_GOVERNED_ENQUEUE_SIBLING_ROOT=$SIBLING_ROOT"
# ⛔ No companion assertion that the fail-open text is ABSENT here — it was
# written, and measured to be a phantom: when the sibling does NOT resolve the
# hook does not print that warning either (it leaves at the cleared-predicate
# exit with empty stderr, per the case above), so the assertion passed in both
# worlds and discriminated nothing. The verdict row above is the discriminator,
# and it is the one that goes red when the sibling stops being resolved.

echo "== an exception row with NO tree to recompute it on takes the fail-open =="
# The branch neither case above reaches, and the reason it needs a third fixture
# rather than a third root: with nothing resolved the register is asked WITHOUT
# `--root`, so it answers about THIS tree, and a path this tree's generator owns
# is LIFTED there — the cleared-predicate `exit 0`, several branches ABOVE the
# fail-open. To reach it the payload must carry a path that stays GOVERNED with
# an exception row wherever the register is asked: a `skills/**` path that no
# generator declares. The hook then holds an exception row and no right tree to
# recompute its provenance on, which is the whole of this branch's premise.
#
# The injected root is the EMPTY one the case above already built — same
# injection, and the path shape is the only thing separating the cleared exit
# from this warning. Reused rather than re-created so the two cases cannot drift
# into asking about different emptiness.
#
# ⛔ Do not "fix" the path to a real skill. A declared path is byte-exact
# against its own output here and is lifted, which would turn this case into a
# silent second copy of the one above — green forever over a branch nothing
# reaches, the exact failure this file was repaired for once already.
#
# Hermetic in both directions and both were measured: with `node_modules`
# present the register answers "does not write … not among the 9 file(s) that
# generator declared on this tree"; without it, "the generator declared no
# output set (the generator's own --check exited 254)". Two reasons, one
# precondition — exit 3 carrying an exception row — and that precondition is all
# this branch reads, so the case holds on an installed worktree and on the bare
# one this file documents itself as running under.
UNGENERATED_PATH=skills/zz-no-such-skill/references/_index.md
F_UNGENERATED="$(fixture ungenerated-exception-row "$(files_of "$UNGENERATED_PATH")" "$NO_REVIEWS")"
# Printed, never asserted: the rows below pin the HOOK's branch, not a register
# verdict, so copying one in would make this matrix a second register again.
# It is here so a dead premise — the register no longer answering governed with
# an exception row for this shape — reads as one line instead of as two
# mysteriously red text assertions.
node "$repo_root/scripts/pm/check-governed-merges.mjs" --test --json "$UNGENERATED_PATH" \
  > "$root/ungenerated-verdict.json" 2>/dev/null
ungenerated_rc=$?
printf '  ..   register verdict on THIS tree for the ungenerated path: exit %s with %s exception row(s)\n' \
  "$ungenerated_rc" "$(jq '.exceptions | length' < "$root/ungenerated-verdict.json" 2>/dev/null || printf '?')"
expect allow 'an exception row with no checkout to recompute it on is waved through, not refused' \
  "$(mcp $AUTO 999 objectstack-ai cloud)" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNGENERATED" "OS_GOVERNED_ENQUEUE_SIBLING_ROOT=$NO_SIBLING_ROOT"
expect_says 'no checkout of objectstack-ai/cloud' 'the fail-open names the repo it could not resolve' \
  "$(mcp $AUTO 999 objectstack-ai cloud)" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNGENERATED" "OS_GOVERNED_ENQUEUE_SIBLING_ROOT=$NO_SIBLING_ROOT"
expect_says 'recompute its provenance' 'the fail-open names the reading that was missing' \
  "$(mcp $AUTO 999 objectstack-ai cloud)" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNGENERATED" "OS_GOVERNED_ENQUEUE_SIBLING_ROOT=$NO_SIBLING_ROOT"
# THE FIRING CONTROL, and it is what keeps the two rows above from being the
# phantom this file has already paid for once: the same payload with the sibling
# RESOLVED (the throwaway built above — one, not two) recomputes on that tree
# and never reaches the branch, so the sentence must be ABSENT there. Measured
# in both directions before it was written: unresolved prints it and allows,
# resolved prints the ordinary governed refusal and blocks. Point either `says`
# row at this root and it goes red — which is the proof a text assertion owes,
# and the reading the companion assertion on the resolved-sibling case could not
# give, since nothing prints that sentence in EITHER of the two worlds it saw.
expect_lacks 'no checkout of' 'the same payload with the sibling RESOLVED never claims a missing checkout' \
  "$(mcp $AUTO 999 objectstack-ai cloud)" \
  "OS_GOVERNED_ENQUEUE_FIXTURE=$F_UNGENERATED" "OS_GOVERNED_ENQUEUE_SIBLING_ROOT=$SIBLING_ROOT"

echo "== every spelling of that same origin URL resolves to that same sibling =="
# The other half of this card's defect. `git clone` hands out
# `https://github.com/objectstack-ai/cloud.git`, and until `slug_of` stripped that
# suffix the slug read back as `objectstack-ai/cloud.git` — equal to no
# `owner/repo` this guard is ever asked about, so a sibling cloned the
# conventional way resolved NOTHING and the case above silently degraded into a
# second copy of the "cannot resolve" one. That is why its origin is pinned to the
# bare form in place; these are the four spellings it does not cover.
#
# Same `$sibling_want`, and deliberately the same variable rather than four more
# register calls: every tree here is built exactly as that one is (an empty
# `git init` plus an `origin`), so the register would be answering the identical
# question about identical content — and the verdict still comes FROM the register
# rather than from a word copied into this file.
#
# ⚠️ `-u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS` is what makes the two
# `git@github.com:` rows MEAN what they say, and it was measured here rather than
# assumed: this container injects `url.https://github.com/.insteadOf
# git@github.com:` through the environment, and the hook reads the origin with
# `git remote get-url`, which HONOURS that rewrite — so without the unset git
# hands the hook `https://…` and both ssh rows silently become second copies of
# the https ones, green forever over a reader they never reach. A row whose
# premise is a property of the box is the defect the cross-repo case above was
# repaired for; these rows own theirs. On a machine that injects nothing, `env -u`
# on an unset name is a no-op.
spelling_n=0
for spelling_url in \
  'https://github.com/objectstack-ai/cloud.git' \
  'git@github.com:objectstack-ai/cloud' \
  'git@github.com:objectstack-ai/cloud.git' \
  'https://github.com/objectstack-ai/cloud.git/' \
  ; do
  spelling_n=$((spelling_n + 1))
  spelling_root="$root/sibling-spelling-$spelling_n"    # under $root: the trap removes it
  mkdir -p "$spelling_root/cloud"
  git -C "$spelling_root/cloud" init -q >/dev/null 2>&1
  git -C "$spelling_root/cloud" remote add origin "$spelling_url" >/dev/null 2>&1
  expect "$sibling_want" "origin $spelling_url resolves and is audited" \
    "$(mcp $AUTO 999 objectstack-ai cloud)" \
    -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS \
    "OS_GOVERNED_ENQUEUE_FIXTURE=$F_CROSS_REGEN" "OS_GOVERNED_ENQUEUE_SIBLING_ROOT=$spelling_root"
done

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
if grep -q 'check-governed-merges.mjs' "$hook" && grep -q 'authorizedApprovalVerdict' "$hook"; then
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
