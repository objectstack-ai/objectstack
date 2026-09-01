#!/usr/bin/env bash
# guard-governed-enqueue.sh — PreToolUse guard: never ENQUEUE a governed PR that
# carries no authorized approval pinned to its CURRENT head sha.
#
# Blocks the enqueue-class tool calls — `mcp__github__enable_pr_auto_merge`,
# `mcp__github__merge_pull_request`, and the Bash spellings (`gh pr merge`, a
# `PUT .../pulls/<n>/merge` REST call) — when the target PR's changed files are
# governed and no account in `GOVERNED_APPROVERS` holds an APPROVED review whose
# `commit_id` equals the PR's current head. Everything else is allowed.
#
# ## Why a CLIENT-SIDE guard, when the queue guard already refuses
#
# `scripts/pm/check-governed-queue-guard.mjs` is the hard correctness line and
# stays it: on the `merge_group` build it reads the reviews live and REFUSES
# (EXIT_REFUSED_UNAPPROVED). It held. What it cannot do is make the refusal
# cheap.
#
# Measured 2026-09-01: a governed PR (four `skills/*/references/_index.md`
# files) was flipped ready and enqueued with ZERO approvals on the PR. The queue
# guard refused exactly as designed, the queue entry popped out red, and the
# maintainer pinned an approval to head `b25f061c6` at 01:53:29Z — after which
# THE RED ENTRY DID NOT RE-RUN. GitHub's merge queue does not retry a failed
# entry when an approval arrives later. So the cost of "enqueue first, get
# approved after" is not zero and never can be: one burned queue cycle plus a
# red entry the maintainer reads as "I reviewed it and it still blocked me".
#
# ⭐ The design note in the queue guard's sibling says the enqueue threshold
# "cannot be stopped by machine — a GitHub model limitation", and that is true
# of GitHub: there is no server-side hook between a seat's enqueue call and the
# queue. It is NOT true of OUR OWN tool-call surface. The enqueue action reaches
# GitHub through a tool call this process makes, and PreToolUse sits in front of
# it. That is the whole idea here — the server-side gate stays where it is, and
# this one removes the wasted cycle before it is spent. The two answer the same
# question with the same code (see "no second mechanism" below), so this guard
# can only ever refuse what the queue guard would also have refused.
#
# The prose alternative was tried and rejected on the spot. The maintainer, on
# the card that produced this file (2026-09-01, verbatim, untranslated):
#
#   > 你写skills 有用吗?他经常会忘记。
#
# ⇒ machine enforcement first; the protocol text is the annotation, not the
# defense. Same lesson the worktree and stash rules already paid for: a ⛔-level
# rule in this repo is only stable once a check enforces it.
#
# ## ⛔ NO SECOND MECHANISM — both predicates are IMPORTED, never restated
#
# This file contains no path list and no approval rule of its own. It asks the
# two existing single sources and reports what they answer:
#
#   1. "is this diff governed?"  →  `check-governed-merges.mjs --test --json`,
#      the very predicate a seat runs before flipping ready. Exit 3 = governed,
#      exit 0 = clear. Its register (`GOVERNED_SURFACES`) is repo-agnostic, so
#      the same call answers for all four governed repos.
#   2. "is it approved, pinned?"  →  `pinnedApprovalVerdict` +
#      `GOVERNED_APPROVERS` imported from `check-governed-queue-guard.mjs` —
#      the same function the queue build decides on, applied to the same review
#      list shape. The authorized set is never spelled out here.
#
# A register row or a ruling that moves either predicate reaches this guard for
# free, and the two tools cannot answer differently about the same diff — the
# #11705 constraint ("⛔ do not author a second mechanism") applied one level
# out.
#
# ## The pure-regeneration class MUST pass, and does so by construction
#
# The maintainer ruled 2026-09-01 (verbatim, untranslated):
#
#   > 纯生成的指针行(spec 源变更后再生成的 references/_index.md) 不需要我审核吧
#
# So a PR whose only governed paths are generator-owned files that byte-equal
# their own generator's output — recomputed on the tree under test, never a
# stored baseline — clears with ZERO approvals. That exemption lives in the
# register's `applyGeneratedExceptions`, and because step 1 above is the
# register's own `--test`, this guard inherits it whole: a pure regeneration
# comes back exit 0 and is ALLOWED before any review is read. This guard must
# never be the thing that re-closes a path the queue guard now clears, and the
# self-test pins that with a REAL lifted path, not a stub.
#
# Fail-closed inside the exemption is the register's business, not this file's:
# a provenance that cannot be recomputed keeps the path governed there, and this
# guard reports that answer rather than softening it. `OS_ALLOW_GOVERNED_ENQUEUE=1`
# is the stated way out when a human knows better.
#
# ## FAIL-OPEN on a read failure — deliberate, and the opposite of the queue guard
#
# ⚠️ The queue guard fails CLOSED on an unreadable review list, and is right to:
# it is the last thing before `main`. This guard is not that, and copying the
# stance here would be wrong. It sits in front of every enqueue attempt with a
# network dependency; a guard that blocks work whenever the API hiccups gets
# switched off, and then it guards nothing. So every branch this file cannot
# ANSWER — no token, an HTTP error, a truncated file list, an unparsable
# payload, a predicate that will not run — ALLOWS, with one warning line on
# stderr naming what it could not read.
#
# That is affordable for exactly one reason, and it should be re-checked if the
# reason ever stops holding: the correctness line is elsewhere. An unapproved
# governed PR that slips past this file still meets `check-governed-queue-guard`
# on the merge-group build and is still refused. What this guard saves is the
# wasted cycle and the false red — never the merge itself.
#
# ## Two premises this file rests on, both MEASURED (2026-09-01, this container)
#
#   ① THE API READ PATH. There is no `gh` in this container class (`command -v
#      gh` → absent). The repo-scoped REST channel is reachable: `GET
#      /repos/{o}/{r}/pulls/{n}`, `.../files` and `.../reviews` each answered
#      HTTP 200, including from a grandchild subprocess two levels down, which
#      is the depth a hook runs at.
#   ⚠️ curl, NOT node's global fetch. `GITHUB_TOKEN` in these containers is the
#      14-byte placeholder `proxy-injected`; the real credential is swapped in
#      on the wire by the agent proxy. curl honours `HTTPS_PROXY` and gets 200.
#      Node's `fetch` does not proxy by default, sends the placeholder verbatim
#      and gets **401** — measured side by side. So the transport here is curl
#      and node only ever receives already-fetched JSON as data. (The queue
#      guard's own `fetch`-based readers are fine where they run: CI holds a
#      real token.)
#   ② FAIL-OPEN, per the section above.
#
# ## Exit-code contract, mirroring the sibling guards
#
#   0 = allow, 2 = block with the reason on stderr. Anything this cannot parse
#   CONFIDENTLY fails open — a guard that blocks work it does not understand
#   gets disabled. Deliberate exception: OS_ALLOW_GOVERNED_ENQUEUE=1.
#
# ## Known boundaries, stated so nobody has to rediscover them
#
#   - `gh pr merge` with NO pull-request argument targets the current branch,
#     which the payload does not name. That form is ALLOWED, with a warning: the
#     PR cannot be identified, and guessing is worse than the queue guard
#     catching it. Pass the number (`gh pr merge 1234`) to be checked.
#   - Like `guard-shared-stash.sh`, the Bash pass reads the FIRST WORD of each
#     shell segment, so a wrapped invocation (`bash -c '…'`, xargs, ssh) is not
#     caught. Same deliberate trade: the target is the reflexive enqueue call an
#     agent makes, not a determined evader — and the switch above already exists
#     for anyone who means it.
#   - A PR with more changed files than this reads (10 pages × 100) is a
#     truncated list; it warns and allows rather than judging a partial diff.
#     Under-enumeration is the one direction a governed reading must never be
#     wrong in (#9902), so a partial answer is refused as an ANSWER, not
#     converted into a refusal of the work.
#
# Test-only injection, documented so it is never mistaken for a bypass:
# OS_GOVERNED_ENQUEUE_FIXTURE=<dir> makes the three reads come from
# `pull.json` / `files.json` / `reviews.json` in that directory instead of the
# network, and OS_GOVERNED_ENQUEUE_READFAIL=1 simulates an unreadable API. They
# change where DATA comes from and nothing else; the open escape hatch above is
# the way to actually skip the guard.
#
# Self-test (no network, no build): .claude/hooks/guard-governed-enqueue.selftest.sh

set -uo pipefail

[ "${OS_ALLOW_GOVERNED_ENQUEUE:-}" = "1" ] && exit 0

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
merges_predicate="$repo_root/scripts/pm/check-governed-merges.mjs"
queue_guard="$repo_root/scripts/pm/check-governed-queue-guard.mjs"
api_base="${GITHUB_API_URL:-https://api.github.com}"

warn() { printf '⚠️  guard-governed-enqueue: %s — ALLOWING (the merge-queue guard remains the hard line).\n' "$1" >&2; }

input="$(cat 2>/dev/null || true)"
[ -n "$input" ] || exit 0

have_jq=0
command -v jq >/dev/null 2>&1 && have_jq=1

# Lift one scalar out of the payload. jq when present; otherwise a flat key scan
# that is good enough for the four fields this guard reads and yields empty —
# which means ALLOW — when it is not.
payload_get() { # payload_get <jq filter> <key name>
  local v=""
  if [ "$have_jq" = 1 ]; then
    v="$(printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null || true)"
  fi
  if [ -z "$v" ]; then
    v="$(printf '%s' "$input" \
      | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p;s/.*\"$2\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" \
      | head -1)"
  fi
  printf '%s' "$v"
}

tool="$(payload_get '.tool_name' 'tool_name')"
[ -n "$tool" ] || exit 0

owner=""
repo=""
pull=""

# ── identify the target PR ───────────────────────────────────────────────────

case "$tool" in
  mcp__github__enable_pr_auto_merge | mcp__github__merge_pull_request)
    owner="$(payload_get '.tool_input.owner' 'owner')"
    repo="$(payload_get '.tool_input.repo' 'repo')"
    pull="$(payload_get '.tool_input.pullNumber' 'pullNumber')"
    ;;
  Bash)
    cmd=""
    if [ "$have_jq" = 1 ]; then
      cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
    fi
    if [ -z "$cmd" ]; then
      # jq-less fallback: lift the JSON string honouring backslash escapes, so an
      # embedded \" does not truncate the command. Same shape guard-shared-stash.sh uses.
      cmd="$(printf '%s' "$input" \
        | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(\(\\.\|[^"\\]\)*\)".*/\1/p' \
        | head -1 \
        | sed 's/\\n/ /g; s/\\t/ /g; s/\\"/"/g; s/\\\\/\\/g')"
    fi
    [ -n "$cmd" ] || exit 0
    ;;
  *) exit 0 ;;
esac

# --- split a Bash command into shell segments, honouring quotes --------------
# A separator inside '…' or "…" does NOT split, so writing ABOUT an enqueue call
# is never caught by the guard. OUTSIDE quotes a backslash escapes the NEXT
# character, so an escaped \" opens no quoted region — without that branch the
# pass goes inert behind one and a real command rides through as an argument of
# something harmless. This is the same repair guard-shared-stash.sh and
# guard-main-checkout-bash.sh both carry; the three passes are kept in the same
# shape on purpose.
segments=()
split_segments() {
  local s="$1" seg="" q="" ch i n=${#1}
  for ((i = 0; i < n; i++)); do
    ch="${s:i:1}"
    if [ -n "$q" ]; then
      seg+="$ch"
      [ "$ch" = "$q" ] && q=""
      continue
    fi
    case "$ch" in
      '\')
        seg+="$ch"
        if [ $((i + 1)) -lt "$n" ]; then i=$((i + 1)) ; seg+="${s:i:1}" ; fi
        ;;
      "'" | '"') q="$ch" ; seg+="$ch" ;;
      ';' | '|' | '&' | '(' | ')' | '{' | '}' | $'\n') segments+=("$seg") ; seg="" ;;
      *) seg+="$ch" ;;
    esac
  done
  segments+=("$seg")
}

# A REST merge URL in any spelling: .../repos/<owner>/<repo>/pulls/<n>/merge
url_target() { # url_target <word> -> "owner repo pull" or empty
  local w="${1//\"/}"
  w="${w//\'/}"
  [[ "$w" =~ /repos/([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)/pulls/([0-9]+)/merge ]] || return 1
  printf '%s %s %s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
}

# The enqueue-class target one shell segment names, or nothing.
segment_target() { # segment_target <segment> -> "owner repo pull" or empty
  local seg="$1"
  local -a w=()
  read -r -a w <<<"$seg"
  local i=0 n=${#w[@]} j hit
  [ "$n" -gt 0 ] || return 1

  while [ "$i" -lt "$n" ]; do
    case "${w[$i]}" in
      [A-Za-z_][A-Za-z0-9_]*=*) i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "$n" ] || return 1

  local head="${w[$i]##*/}"

  # `curl … https://api.github.com/repos/o/r/pulls/N/merge` — the URL shape is
  # the identification; no method sniffing, because that URL has no read verb.
  if [ "$head" = "curl" ] || [ "$head" = "wget" ]; then
    for ((j = i + 1; j < n; j++)); do
      if hit="$(url_target "${w[$j]}")"; then printf '%s' "$hit"; return 0; fi
    done
    return 1
  fi

  [ "$head" = "gh" ] || return 1
  i=$((i + 1))

  # `gh api … /repos/o/r/pulls/N/merge`
  if [ "${w[$i]:-}" = "api" ]; then
    for ((j = i + 1; j < n; j++)); do
      if hit="$(url_target "${w[$j]}")"; then printf '%s' "$hit"; return 0; fi
    done
    return 1
  fi

  # `gh pr merge …`
  [ "${w[$i]:-}" = "pr" ] || return 1
  i=$((i + 1))
  [ "${w[$i]:-}" = "merge" ] || return 1
  i=$((i + 1))

  local slug="" num=""
  for ((j = i; j < n; j++)); do
    case "${w[$j]}" in
      -R | --repo) slug="${w[$((j + 1))]:-}" ; j=$((j + 1)) ;;
      -R=* | --repo=*) slug="${w[$j]#*=}" ;;
      -*) ;;
      *)
        if [ -z "$num" ]; then
          if [[ "${w[$j]}" =~ ^([0-9]+)$ ]]; then
            num="${BASH_REMATCH[1]}"
          elif [[ "${w[$j]}" =~ ^https?://[^/]+/([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)/pull/([0-9]+) ]]; then
            slug="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
            num="${BASH_REMATCH[3]}"
          fi
        fi
        ;;
    esac
  done

  # No number: `gh pr merge` on the CURRENT branch. The payload does not name
  # the PR, so this is the parse-confidently-or-allow line — see the header.
  if [ -z "$num" ]; then
    warn "'gh pr merge' names no pull request (it would target the current branch), so the PR cannot be identified"
    return 1
  fi
  if [ -z "$slug" ]; then
    slug="$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)"
    slug="$(printf '%s' "$slug" | sed -n 's#.*github\.com[:/]\([A-Za-z0-9._-]*/[A-Za-z0-9._-]*\)\(\.git\)\{0,1\}/*$#\1#p')"
  fi
  [ -n "$slug" ] || return 1
  printf '%s %s %s' "${slug%%/*}" "${slug#*/}" "$num"
}

if [ "$tool" = "Bash" ]; then
  split_segments "$cmd"
  for seg in "${segments[@]}"; do
    if target="$(segment_target "$seg")"; then
      read -r owner repo pull <<<"$target"
      break
    fi
  done
fi

# Nothing identifiable ⇒ this call is not our business, or we could not parse it
# confidently. Either way: allow.
[ -n "$owner" ] && [ -n "$repo" ] && [ -n "$pull" ] || exit 0
[[ "$pull" =~ ^[0-9]+$ ]] || exit 0

# ── read the PR: head sha, changed files, reviews ────────────────────────────

work="$(mktemp -d 2>/dev/null)" || { warn "could not create a temporary directory"; exit 0; }
trap 'rm -rf "$work"' EXIT INT TERM

api_get() { # api_get <path-and-query> <outfile> -> 0 on HTTP 200
  local path="$1" out="$2" code
  if [ -n "${OS_GOVERNED_ENQUEUE_FIXTURE:-}" ]; then
    [ "${OS_GOVERNED_ENQUEUE_READFAIL:-}" = "1" ] && return 1
    local name
    case "$path" in
      */files*) name=files.json ;;
      */reviews*) name=reviews.json ;;
      *) name=pull.json ;;
    esac
    [ -f "$OS_GOVERNED_ENQUEUE_FIXTURE/$name" ] || return 1
    cat "$OS_GOVERNED_ENQUEUE_FIXTURE/$name" > "$out" 2>/dev/null || return 1
    return 0
  fi
  code="$(curl -sS --max-time 10 -o "$out" -w '%{http_code}' \
    -H "Authorization: Bearer ${GITHUB_TOKEN:-${GH_TOKEN:-}}" \
    -H 'Accept: application/vnd.github+json' \
    "$api_base$path" 2>/dev/null)" || return 1
  [ "$code" = "200" ]
}

pr_ref="$owner/$repo#$pull"

api_get "/repos/$owner/$repo/pulls/$pull" "$work/pull.json" \
  || { warn "could not read $pr_ref"; exit 0; }

# ⚠️ EVERY API body is parsed by node, never by sed — and never by jq either, so
# there is ONE reading rather than a fast path and a fallback that can disagree.
# The rejected spelling and why: a line-based `sed -n 's/.*"filename".*/\1/p'`
# over GitHub's single-line array is GREEDY, so it returns the LAST filename in
# the body and NOTHING ELSE. That is under-enumeration of a governed diff — the
# one direction a governed-surface reading must never be wrong in (#9902) — and
# it fails silently, as a shorter list, at exit 0. Measured here on a two-file
# fixture before this comment existed: 2 files in, 0 out.
#
# node is already a hard dependency (both predicates are node), so this costs
# nothing that was not already being paid. jq stays for the PAYLOAD read alone,
# where the fields are flat and the cost of a node spawn would be charged to
# every Bash tool call in the session.
json_read() { # json_read <file> <mode: head-sha|filenames|count|exceptions|hits>
  OS_GUARD_FILE="$1" OS_GUARD_MODE="$2" node -e '
const fs = require("node:fs");
let d;
try { d = JSON.parse(fs.readFileSync(process.env.OS_GUARD_FILE, "utf8")); }
catch { process.exit(1); }
const mode = process.env.OS_GUARD_MODE;
if (mode === "head-sha") { const s = d && d.head && d.head.sha; if (!s) process.exit(1); console.log(s); }
else if (mode === "filenames") { if (!Array.isArray(d)) process.exit(1); for (const f of d) if (f && f.filename) console.log(f.filename); }
else if (mode === "count") { if (!Array.isArray(d)) process.exit(1); console.log(d.length); }
else if (mode === "exceptions") console.log(((d || {}).exceptions || []).length);
else if (mode === "hits") console.log((((d || {}).hitPaths) || []).join(", "));
else process.exit(1);
' 2>/dev/null
}

head_sha="$(json_read "$work/pull.json" head-sha)"
[[ "$head_sha" =~ ^[0-9a-fA-F]{7,40}$ ]] || { warn "could not read the head sha of $pr_ref"; exit 0; }

# Changed files, paginated. A list this cannot read WHOLE is not an answer.
: > "$work/files.txt"
page=1
truncated=0
while [ "$page" -le 10 ]; do
  api_get "/repos/$owner/$repo/pulls/$pull/files?per_page=100&page=$page" "$work/files.json" \
    || { warn "could not read the changed files of $pr_ref"; exit 0; }
  count="$(json_read "$work/files.json" count)"
  [ -n "$count" ] || { warn "could not parse the changed files of $pr_ref"; exit 0; }
  json_read "$work/files.json" filenames >> "$work/files.txt"
  [ "$count" -eq 100 ] || break
  page=$((page + 1))
  [ "$page" -gt 10 ] && truncated=1
done
if [ "$truncated" = 1 ]; then
  warn "$pr_ref changes more files than this guard reads (10 pages x 100); a truncated diff is not a governed-surface answer"
  exit 0
fi

# Read the list with a while-read loop, never the bash-4 builtin the repo-wide
# floor gate refuses (scripts/check-bash32-floor.mjs): macOS ships bash 3.2, and
# a 127 there would take this guard out entirely on the operator's own machine.
changed=()
while IFS= read -r changed_line; do
  [ -n "$changed_line" ] && changed+=("$changed_line")
done < "$work/files.txt"
[ "${#changed[@]}" -gt 0 ] || { warn "$pr_ref reported no changed files"; exit 0; }

# ── predicate 1: is the diff governed? (the register's own --test) ───────────
#
# Provenance for the generated-artifact exception is recomputed on a TREE, so it
# has to be the target repo's own tree. Resolve a checkout whose origin actually
# declares owner/repo — never audit one repo's paths against another's files.

slug_of() { git -C "$1" remote get-url origin 2>/dev/null | sed -n 's#.*github\.com[:/]\([A-Za-z0-9._-]*/[A-Za-z0-9._-]*\)\(\.git\)\{0,1\}/*$#\1#p'; }

target_root=""
if [ "$(slug_of "$repo_root")" = "$owner/$repo" ]; then
  target_root="$repo_root"
elif [ "$(slug_of "$(dirname "$repo_root")/$repo")" = "$owner/$repo" ]; then
  target_root="$(dirname "$repo_root")/$repo"
fi

test_args=(--test --json)
[ -n "$target_root" ] && test_args+=(--root "$target_root")
node "$merges_predicate" "${test_args[@]}" "${changed[@]}" > "$work/test.json" 2> "$work/test.err"
test_rc=$?

case "$test_rc" in
  0) exit 0 ;;                       # not governed, or fully lifted by the exception
  3) ;;                              # governed
  *) warn "the governed-surface predicate did not run (exit $test_rc): $(tr '\n' ' ' < "$work/test.err" | cut -c1-200)"; exit 0 ;;
esac

# A hit on a generated-exception row is judged by recomputing the generator on a
# tree. With no checkout of the target repo there is no right tree to recompute
# on, and the register's fail-closed answer then reflects the ENVIRONMENT rather
# than the diff — a false refusal. Allow, and say which reading was missing.
exception_rows="$(json_read "$work/test.json" exceptions)"
if [ -z "$target_root" ] && [ "${exception_rows:-unknown}" != "0" ]; then
  warn "$pr_ref may hit a generated-surface exception row, and no checkout of $owner/$repo is available to recompute its provenance on"
  exit 0
fi

hits="$(json_read "$work/test.json" hits)"

# ── predicate 2: an authorized approval pinned to THIS head ──────────────────

api_get "/repos/$owner/$repo/pulls/$pull/reviews?per_page=100" "$work/reviews.json" \
  || { warn "could not read the reviews of $pr_ref"; exit 0; }

# ⚠️ The three inputs travel as ENV, never as argv. `isEntrypoint` (scripts/
# invoked-as.mjs) decides "was I run or imported?" by comparing `process.argv[1]`
# against the module's own URL — so passing the module PATH as the first
# argument makes the import look like a direct run, and the queue guard's own
# main() fires, complains about a missing GITHUB_EVENT_PATH and exits 1.
# Measured here before this line was written.
verdict="$(OS_GUARD_MODULE="$queue_guard" OS_GUARD_REVIEWS="$work/reviews.json" OS_GUARD_HEAD="$head_sha" \
  node --input-type=module -e '
const { OS_GUARD_MODULE: modPath, OS_GUARD_REVIEWS: reviewsPath, OS_GUARD_HEAD: headSha } = process.env;
const { readFileSync } = await import("node:fs");
const m = await import(modPath);
const reviews = JSON.parse(readFileSync(reviewsPath, "utf8"));
const v = m.pinnedApprovalVerdict(reviews, headSha);
// Line 1 is the verdict word the shell branches on; line 2 is the human detail.
// Rendered HERE rather than in the shell so there is one reading of this object.
const detail = [
  `reviews read: ${v.reviewsRead}`,
  v.staleApprovers.length
    ? `STALE approval(s), pinned to an earlier head: ${v.staleApprovers.map((s) => `${s.login}@${String(s.commitId).slice(0, 9)}`).join(", ")}`
    : null,
  v.unauthorizedApprovers.length
    ? `APPROVED by account(s) outside the authorized set (never counts): ${v.unauthorizedApprovers.join(", ")}`
    : null,
  v.changesRequestedBy.length ? `CHANGES_REQUESTED standing from: ${v.changesRequestedBy.join(", ")}` : null,
  `authorized approvers (GOVERNED_APPROVERS): ${m.GOVERNED_APPROVERS.join(", ")}`,
].filter(Boolean).join("; ");
console.log(v.state);
console.log(detail);
' 2> "$work/verdict.err")"
verdict_rc=$?

if [ "$verdict_rc" -ne 0 ] || [ -z "$verdict" ]; then
  warn "the pinned-approval predicate did not run: $(tr '\n' ' ' < "$work/verdict.err" | cut -c1-200)"
  exit 0
fi

state="$(printf '%s\n' "$verdict" | head -1)"
detail="$(printf '%s\n' "$verdict" | tail -n +2)"

[ "$state" = "approved" ] && exit 0

cat >&2 <<EOF
⛔ Blocked: $pr_ref is GOVERNED and has no APPROVED review pinned to its current head —
   approve BEFORE enqueue; a failed queue entry does NOT re-run on a later approval.

   tool:      $tool
   head:      $head_sha
   governed:  ${hits:-see the predicate output below}
   approvals: $detail

Enqueuing now does not fail safe, it fails EXPENSIVELY. The merge-queue guard
(scripts/pm/check-governed-queue-guard.mjs) reads the reviews on the merge_group
build and refuses, so nothing wrong lands — but GitHub does not retry that queue
entry when the approval arrives afterwards. The entry stays red, one queue cycle
is spent, and the red reads to the maintainer as "I approved it and it still
blocked me". That exact sequence was measured on 2026-09-01.

Do this instead:
  1. Leave the PR as a DRAFT and request review from an authorized approver.
  2. Wait for the APPROVED review to land on THIS head sha ($head_sha).
     A push after the approval unpins it — re-request, do not re-enqueue.
  3. Then enqueue. Or let the maintainer merge by hand: a human merge IS the
     review record for a governed PR, and it needs nothing from this guard.
  ⛔ Never approve a governed PR from an agent seat, under any account.

Pure regeneration is already exempt and never reaches this message: a diff whose
only governed paths byte-equal their own generator's output clears with zero
approvals, decided by the register (check-governed-merges.mjs), not here.

Verdict source: check-governed-merges.mjs --test (governed) +
pinnedApprovalVerdict/GOVERNED_APPROVERS from check-governed-queue-guard.mjs.
Deliberate exception (you know this one is right): OS_ALLOW_GOVERNED_ENQUEUE=1.
EOF
exit 2
