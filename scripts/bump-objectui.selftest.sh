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
# Offline, no node, no network: throwaway git repos under `mktemp -d`, and the
# script under test is exercised as a byte copy inside a throwaway FRAMEWORK_ROOT
# (the real one is derived from `${BASH_SOURCE[0]}/..`, so a copy is the only way
# to run it without writing into this repo's own `.objectui-sha`).

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

echo "bump-objectui.sh self-test — write-ordering invariant (#10797)"
case_1
case_2
case_3
case_4

echo
if [[ "$FAILED" -gt 0 ]]; then
  echo "✗ bump-objectui self-test FAILED — ${FAILED} assertion(s) failed, ${PASSED} passed." >&2
  exit 1
fi
echo "✓ bump-objectui self-test PASSED — ${PASSED} assertions across 4 cases."
