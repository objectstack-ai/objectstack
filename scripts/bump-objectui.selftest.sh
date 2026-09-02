#!/usr/bin/env bash
# Self-test for scripts/bump-objectui.sh — the WRITE-ORDERING invariant (#10797).
#
#   bash scripts/bump-objectui.selftest.sh
#
# THE INVARIANT UNDER TEST
#   A bump that cannot read the objectui commit object REFUSES, and leaves
#   `.objectui-sha` BYTE-IDENTICAL to what it was before the run.
#
# The bill this pins: the pin file used to be written BEFORE the run read the
# commit subject, so an unreadable commit object killed the script under `set -e`
# with `.objectui-sha` already rewritten — no changeset, no commit, and a bare
# `fatal: bad object` as the whole explanation. Re-running did not self-correct:
# the pin file now held the bad SHA, so the next run compared against it.
#
# WHY THE ASSERTION IS ON BYTES, NOT ON THE MESSAGE. Both the broken and the
# fixed script exit non-zero on this input — 128 from `set -e` versus 1 from the
# refusal — so "did it fail?" does not discriminate between them and a test that
# asked only that would have passed against the defect. What discriminates is the
# file: the broken ordering rewrites it, the fixed one does not. So every refusal
# case snapshots `.objectui-sha` and compares with `cmp` (byte-for-byte, and it
# needs no hashing tool), and the absent-pin case asserts the file was not
# CREATED. Verified by ablation, 2026-08-21: with the reads moved back after the
# write, cases 1 and 2 both go red on exactly that assertion.
#
# AND THE GUARD MUST NOT BE VACUOUS. `exit 1` at the top of bump-objectui.sh
# would satisfy every refusal case above, so cases 3 and 4 drive readable commits
# all the way through and assert the pin MOVES (and that an already-current pin
# is left alone). A guard that refuses everything fails them.
#
# CASE 5 PINS A SECOND, NARROWER REFUSAL (#14393): the range can WALK
# COMPLETELY (every commit and tree object present) and the bump still must
# refuse, because the changeset BLOB the digest needs to derive a bump level is
# unreadable at both revisions. This is not the #9408/#14178 shape above — the
# discriminator is `RANGE_OK`, settled by the commit/tree walk alone — so this
# case builds a real objectui changeset commit and deletes only its blob
# object, then asserts `--check-walkable` still exits 0 on the broken tree
# before asserting the bump itself refuses. This bump used to emit a degraded
# `patch` changeset here instead (silently, exit 0) — see the reproduction log
# in the #14393 PR body for the byte-for-byte before/after.
#
# Cases 1-4 stay offline, no node, no network: throwaway git repos under
# `mktemp -d`, and the script under test is exercised as a byte copy inside a
# throwaway FRAMEWORK_ROOT (the real one is derived from `${BASH_SOURCE[0]}/..`,
# so a copy is the only way to run it without writing into this repo's own
# `.objectui-sha`). Case 5 additionally needs node, offline still: it drives
# the real `objectui-changeset-digest.mjs` (a byte copy, like the script under
# test) through a throwaway objectui repo with a real changeset commit.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNDER_TEST="${SCRIPT_DIR}/bump-objectui.sh"

if [[ ! -f "$UNDER_TEST" ]]; then
  echo "✗ cannot find the script under test at ${UNDER_TEST}" >&2
  exit 1
fi

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

PASSED=0
FAILED=0
CASE=""

ok()   { echo "    ✓ $*"; PASSED=$((PASSED + 1)); }
bad()  { echo "    ✗ $*" >&2; FAILED=$((FAILED + 1)); }
case_begin() { CASE="$1"; echo "  • ${CASE}"; }

# case_5 additionally needs a copy of the digest script `bump-objectui.sh`
# calls and the `isEntrypoint` helper it imports, alongside the script under
# test — mirroring `objectui-changeset-digest.mjs`'s own self-test fixtures
# (which copy the same trio for the same reason).
DIGEST_SCRIPT="${SCRIPT_DIR}/objectui-changeset-digest.mjs"
INVOKED_AS_SCRIPT="${SCRIPT_DIR}/invoked-as.mjs"

# --- fixtures ----------------------------------------------------------------

# A throwaway objectui with two commits and an `origin/main` that matches HEAD,
# so the #10495 reachability report answers "on origin/main" instead of "UNKNOWN"
# and cannot be mistaken for the thing being tested here.
new_objectui() {
  local d="$1"
  mkdir -p "$d"
  git -C "$d" init -q
  git -C "$d" symbolic-ref HEAD refs/heads/main
  git -C "$d" config user.email 'selftest@example.invalid'
  git -C "$d" config user.name 'selftest'
  git -C "$d" config commit.gpgsign false
  # No commit-graph and no auto-gc: both can answer for an object that is no
  # longer in the store, which would quietly defuse the fixture below.
  git -C "$d" config gc.auto 0
  git -C "$d" config core.commitGraph false
  git -C "$d" config fetch.writeCommitGraph false
  git -C "$d" commit -q --allow-empty -m 'feat(console): the previous pin'
  git -C "$d" commit -q --allow-empty -m 'feat(console): the commit being pinned'
  git -C "$d" update-ref refs/remotes/origin/main HEAD
  git -C "$d" rev-parse HEAD
}

# A throwaway FRAMEWORK_ROOT holding a byte copy of the script under test.
new_framework() {
  local d="$1" pin="${2-}"
  mkdir -p "${d}/scripts" "${d}/.changeset"
  cp "$UNDER_TEST" "${d}/scripts/bump-objectui.sh"
  if [[ -n "$pin" ]]; then printf '%s\n' "$pin" > "${d}/.objectui-sha"; fi
}

# Same, plus a byte copy of the digest script `bump-objectui.sh` shells out to
# and the `invoked-as.mjs` helper it imports — needed only by cases that do NOT
# pass `--no-changeset` and so actually reach the changeset section.
new_framework_with_digest() {
  local d="$1" pin="${2-}"
  new_framework "$d" "$pin"
  cp "$DIGEST_SCRIPT" "${d}/scripts/objectui-changeset-digest.mjs"
  cp "$INVOKED_AS_SCRIPT" "${d}/scripts/invoked-as.mjs"
}

# A throwaway objectui repo with a REAL changeset commit — commit A (the
# previous pin), commit B adding `.changeset/<name>.md` declaring a real
# package/level, so the range A..B WALKS COMPLETELY and the digest has a real
# blob to read (#14393). Prints "OLD_SHA NEW_SHA" on stdout.
new_objectui_with_changeset() {
  local d="$1"
  mkdir -p "$d"
  git -C "$d" init -q
  git -C "$d" symbolic-ref HEAD refs/heads/main
  git -C "$d" config user.email 'selftest@example.invalid'
  git -C "$d" config user.name 'selftest'
  git -C "$d" config commit.gpgsign false
  git -C "$d" config gc.auto 0
  git -C "$d" config core.commitGraph false
  git -C "$d" config fetch.writeCommitGraph false
  git -C "$d" commit -q --allow-empty -m 'feat(console): the previous pin'
  local old_sha
  old_sha="$(git -C "$d" rev-parse HEAD)"
  mkdir -p "${d}/.changeset"
  cat > "${d}/.changeset/widget-refresh.md" <<'EOF'
---
"@object-ui/core": minor
---

Refresh the widget palette.
EOF
  git -C "$d" add .changeset/widget-refresh.md
  git -C "$d" commit -q -m 'feat(core): refresh the widget palette'
  local new_sha
  new_sha="$(git -C "$d" rev-parse HEAD)"
  git -C "$d" update-ref refs/remotes/origin/main HEAD
  printf '%s %s\n' "$old_sha" "$new_sha"
}

# Delete the changeset blob added at `sha` under `path` from the object store,
# then PROVE it is gone — same discipline as `break_commit_object`, one layer
# further in (a blob, not a commit object). `--check-walkable` walks commits
# and trees, never blobs, so this leaves the range walk green (asserted by the
# caller) while making `readAt` fail at BOTH `to` and the commit that added it
# — `to` and `sha` are the SAME commit in this fixture (the changeset is read
# at the tip that added it, before any release consumes it), so a single
# deleted blob object answers both reads identically.
break_changeset_blob() {
  local d="$1" sha="$2" path="$3"
  local blob
  blob="$(git -C "$d" rev-parse "${sha}:${path}")"
  local loose="${d}/.git/objects/${blob:0:2}/${blob:2}"
  if [[ ! -f "$loose" ]]; then
    bad "fixture: expected a loose blob object at ${loose}, found none (packed already?)"
    return 1
  fi
  rm -f "$loose"
  if git -C "$d" cat-file -e "$blob" 2>/dev/null; then
    bad "fixture: blob ${blob:0:12} is still readable after deleting it"
    return 1
  fi
  printf '%s\n' "$blob"
  return 0
}

# Delete a commit object from the store, then PROVE it is gone. A fixture that
# silently failed to break anything is the one way this whole file could go
# green over nothing, so the proof is an assertion, not a comment.
break_commit_object() {
  local d="$1" sha="$2"
  local loose="${d}/.git/objects/${sha:0:2}/${sha:2}"
  if [[ ! -f "$loose" ]]; then
    bad "fixture: expected a loose object at ${loose}, found none (packed already?)"
    return 1
  fi
  rm -f "$loose"
  if git -C "$d" cat-file -e "${sha}^{commit}" 2>/dev/null; then
    bad "fixture: commit object ${sha:0:12} is still readable after deleting it"
    return 1
  fi
  if git -C "$d" log -1 --format=%s "$sha" >/dev/null 2>&1; then
    bad "fixture: 'git log' still reads ${sha:0:12} after deleting the object"
    return 1
  fi
  # The card's own measurement, re-asserted here because it is what makes the
  # DEFAULT path (no argument) able to reach the bug at all: `rev-parse HEAD`
  # resolves the ref without reading the object, and exits 0.
  local resolved rc=0
  resolved="$(git -C "$d" rev-parse HEAD 2>/dev/null)" || rc=$?
  if [[ "$rc" -ne 0 || "$resolved" != "$sha" ]]; then
    bad "fixture: 'git rev-parse HEAD' no longer resolves to ${sha:0:12} (rc=${rc})"
    return 1
  fi
  return 0
}

# Run the copy under test. No pipe anywhere near the exit code: redirect to a
# file, THEN read `$?`.
LOG=""
EC=0
run_bump() {
  local fw="$1" oui="$2"; shift 2
  LOG="${TMPROOT}/run-$$-${RANDOM}.log"
  EC=0
  OBJECTUI_ROOT="$oui" bash "${fw}/scripts/bump-objectui.sh" "$@" > "$LOG" 2>&1 || EC=$?
}

log_has() { grep -qF -- "$1" "$LOG"; }

# --- case 1: unreadable commit object ⇒ refusal, pin file untouched ----------
case_1() {
  case_begin 'unreadable commit object ⇒ refuses, .objectui-sha byte-identical'
  local fw="${TMPROOT}/c1/fw" oui="${TMPROOT}/c1/objectui"
  local new_sha old_sha
  new_sha="$(new_objectui "$oui")"
  old_sha="$(git -C "$oui" rev-parse 'HEAD~1')"
  new_framework "$fw" "$old_sha"
  break_commit_object "$oui" "$new_sha" || return 0

  cp "${fw}/.objectui-sha" "${TMPROOT}/c1.before"
  run_bump "$fw" "$oui" --no-commit --no-changeset

  if [[ "$EC" -eq 0 ]]; then
    bad "expected a non-zero exit, got 0 — the bump did not refuse"
  else
    ok "refused (exit ${EC})"
  fi
  # THE discriminating assertion.
  if cmp -s "${TMPROOT}/c1.before" "${fw}/.objectui-sha"; then
    ok ".objectui-sha is byte-identical to before the run"
  else
    bad ".objectui-sha CHANGED — half-applied state: $(cat "${fw}/.objectui-sha")"
  fi
  if log_has 'REFUSING to bump'; then
    ok 'the refusal names itself rather than leaving git'"'"'s fatal as the whole message'
  else
    bad "no 'REFUSING to bump' in the output; got: $(head -3 "$LOG" | tr '\n' '|')"
  fi
  if log_has 'NOTHING WAS WRITTEN'; then
    ok 'the message states that nothing was written'
  else
    bad "the refusal does not tell the operator the tree is clean"
  fi
  if [[ ! -e "${fw}/.changeset/console-${new_sha:0:12}.md" ]]; then
    ok 'no changeset was emitted'
  else
    bad 'a changeset was emitted for a commit that cannot be read'
  fi
}

# --- case 2: same, with no pin file at all (initial pin) ---------------------
# Byte-identity of a file that does not exist is "it still does not exist". The
# broken ordering CREATES it here, which is the same defect wearing the
# first-ever-bump disguise.
case_2() {
  case_begin 'unreadable commit object + no existing pin file ⇒ the file is not created'
  local fw="${TMPROOT}/c2/fw" oui="${TMPROOT}/c2/objectui"
  local new_sha
  new_sha="$(new_objectui "$oui")"
  new_framework "$fw"
  break_commit_object "$oui" "$new_sha" || return 0

  if [[ -e "${fw}/.objectui-sha" ]]; then
    bad 'fixture: the pin file should not exist yet'
    return 0
  fi
  run_bump "$fw" "$oui" --no-commit --no-changeset

  if [[ "$EC" -ne 0 ]]; then ok "refused (exit ${EC})"; else bad 'expected a non-zero exit, got 0'; fi
  if [[ ! -e "${fw}/.objectui-sha" ]]; then
    ok '.objectui-sha was not created'
  else
    bad ".objectui-sha was CREATED holding $(cat "${fw}/.objectui-sha")"
  fi
}

# --- case 3: a readable commit still bumps (the guard is not vacuous) -------
case_3() {
  case_begin 'readable commit ⇒ the bump proceeds and the pin moves'
  local fw="${TMPROOT}/c3/fw" oui="${TMPROOT}/c3/objectui"
  local new_sha old_sha
  new_sha="$(new_objectui "$oui")"
  old_sha="$(git -C "$oui" rev-parse 'HEAD~1')"
  new_framework "$fw" "$old_sha"

  run_bump "$fw" "$oui" --no-commit --no-changeset

  if [[ "$EC" -eq 0 ]]; then ok 'exited 0'; else bad "expected exit 0, got ${EC}: $(tail -5 "$LOG" | tr '\n' '|')"; fi
  local written
  written="$(tr -d '[:space:]' < "${fw}/.objectui-sha" 2>/dev/null || true)"
  if [[ "$written" == "$new_sha" ]]; then
    ok ".objectui-sha now holds ${new_sha:0:12}"
  else
    bad ".objectui-sha holds '${written}', expected ${new_sha}"
  fi
  if log_has '(on origin/main)'; then
    ok 'the #10495 reachability report still runs and answers "on origin/main"'
  else
    bad "the reachability report did not answer: $(head -5 "$LOG" | tr '\n' '|')"
  fi
}

# --- case 4: an already-current pin is left alone ---------------------------
case_4() {
  case_begin 'readable commit already pinned ⇒ nothing to do, pin file untouched'
  local fw="${TMPROOT}/c4/fw" oui="${TMPROOT}/c4/objectui"
  local new_sha
  new_sha="$(new_objectui "$oui")"
  new_framework "$fw" "$new_sha"
  cp "${fw}/.objectui-sha" "${TMPROOT}/c4.before"

  run_bump "$fw" "$oui" --no-commit --no-changeset

  if [[ "$EC" -eq 0 ]]; then ok 'exited 0'; else bad "expected exit 0, got ${EC}"; fi
  if log_has 'nothing to do'; then ok 'reported "nothing to do"'; else bad 'did not report "nothing to do"'; fi
  if cmp -s "${TMPROOT}/c4.before" "${fw}/.objectui-sha"; then
    ok '.objectui-sha is byte-identical to before the run'
  else
    bad '.objectui-sha was rewritten on a no-op bump'
  fi
}

# --- case 5: range WALKS, changeset blob unreadable at both revisions -------
# (#14393.) Discriminator from case 1/2: the COMMIT object is fully readable
# and the range walks completely — only the changeset BLOB the digest needs to
# derive a level is gone. Discriminator from the initial-pin degrade (which
# this file does not otherwise exercise): there IS a previous SHA and the
# range DOES walk, so a level was derivable in principle and the derivation
# failed rather than never having an input.
case_5() {
  case_begin 'range walks, changeset blob unreadable at both revisions ⇒ refuses, .objectui-sha byte-identical'
  local fw="${TMPROOT}/c5/fw" oui="${TMPROOT}/c5/objectui"
  local shas old_sha new_sha
  shas="$(new_objectui_with_changeset "$oui")"
  old_sha="${shas%% *}"
  new_sha="${shas##* }"
  new_framework_with_digest "$fw" "$old_sha"

  local walk_rc=0
  node "$DIGEST_SCRIPT" --objectui-root "$oui" --from "$old_sha" --to "$new_sha" \
    --check-walkable >/dev/null 2>&1 || walk_rc=$?
  if [[ "$walk_rc" -ne 0 ]]; then
    bad "fixture: the range does not walk BEFORE breaking the blob (rc=${walk_rc}) — not this card's state"
    return 0
  fi

  break_changeset_blob "$oui" "$new_sha" '.changeset/widget-refresh.md' >/dev/null || return 0

  # Re-assert walkability AFTER breaking the blob — the whole point of this
  # case is that the commit/tree walk stays green while the blob read fails.
  walk_rc=0
  node "$DIGEST_SCRIPT" --objectui-root "$oui" --from "$old_sha" --to "$new_sha" \
    --check-walkable >/dev/null 2>&1 || walk_rc=$?
  if [[ "$walk_rc" -eq 0 ]]; then
    ok 'fixture: --check-walkable still exits 0 after the blob is deleted (walk is commits/trees, not blobs)'
  else
    bad "fixture: --check-walkable now exits ${walk_rc} — the blob deletion broke the WALK, not just the blob read"
    return 0
  fi

  cp "${fw}/.objectui-sha" "${TMPROOT}/c5.before"
  run_bump "$fw" "$oui" --no-commit "$new_sha"

  if [[ "$EC" -eq 0 ]]; then
    bad "expected a non-zero exit, got 0 — the bump did not refuse"
  else
    ok "refused (exit ${EC})"
  fi
  if cmp -s "${TMPROOT}/c5.before" "${fw}/.objectui-sha"; then
    ok ".objectui-sha is byte-identical to before the run"
  else
    bad ".objectui-sha CHANGED — half-applied state: $(cat "${fw}/.objectui-sha")"
  fi
  if log_has 'REFUSING to bump'; then
    ok 'the refusal names itself'
  else
    bad "no 'REFUSING to bump' in the output; got: $(tail -10 "$LOG" | tr '\n' '|')"
  fi
  if log_has 'walks'; then
    ok 'the refusal says the range WALKS (the discriminator from the unwalkable-range refusal)'
  else
    bad "the refusal does not say the range walks: $(tail -10 "$LOG" | tr '\n' '|')"
  fi
  if log_has 'NOTHING WAS WRITTEN'; then
    ok 'the message states that nothing was written'
  else
    bad "the refusal does not tell the operator the tree is clean"
  fi
  if [[ ! -e "${fw}/.changeset/console-${new_sha:0:12}.md" ]]; then
    ok 'no changeset was emitted'
  else
    bad 'a changeset was emitted for a range whose derivation failed'
  fi
}

echo "bump-objectui.sh self-test — write-ordering invariant (#10797)"
case_1
case_2
case_3
case_4
case_5

echo
if [[ "$FAILED" -gt 0 ]]; then
  echo "✗ bump-objectui self-test FAILED — ${FAILED} assertion(s) failed, ${PASSED} passed." >&2
  exit 1
fi
echo "✓ bump-objectui self-test PASSED — ${PASSED} assertions across 5 cases."
