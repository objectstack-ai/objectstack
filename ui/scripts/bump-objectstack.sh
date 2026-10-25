#!/usr/bin/env bash
# Bump the objectstack commit this workspace builds @objectstack/* from.
#
# Usage:
#   scripts/bump-objectstack.sh                 # pin the HEAD of ../objectstack
#   scripts/bump-objectstack.sh <sha|ref>       # pin an explicit commit, e.g. origin/main
#   scripts/bump-objectstack.sh --no-commit     # write the pin and its manifests, do not commit
#
# The bump BUILDS the new pin (`objectstack-pin.mjs build --write-manifests`, which
# fetches the commit and needs the network) and commits `.objectstack-sha` together
# with the packed manifests in `.objectstack-pin/` -- what Dependabot resolves the
# lockfile from (objectui#13008). A build that fails restores the old pin.
#
# After the bump -- the second half, printed on the way out:
#   pnpm install             # links that build; rewrites pnpm-lock.yaml only when the pinned
#                            # packages' dependencies, peers or engines moved -- commit it then,
#                            # or every frozen install (CI's) refuses the lockfile
#
# The pin must name a commit that is on objectstack MAIN. This script WARNS -- it
# does not refuse -- when the commit being pinned is not reachable from the
# objectstack checkout's `origin/main`, and names the branch(es) it IS on. It never
# fetches for you: `origin/main` is only as fresh as your last fetch, and this
# script stays usable offline. Three answers, never two -- a checkout that cannot
# answer the question says so rather than guessing.
#
# It DOES refuse -- before writing anything -- when the commit cannot be resolved
# or its object cannot be read in the objectstack checkout. There is nothing
# meaningful to pin, and a failed run leaves no half-applied state:
# `.objectstack-sha` stays byte-identical to what it was before the run.
#
# Env:
#   OBJECTSTACK_ROOT   the objectstack checkout to read (default: ../objectstack
#                      beside this repository)
#
# This mirrors objectstack's `scripts/bump-objectui.sh` -- its refusal and warning
# contract, not its changeset or SDUI-manifest steps, which have no counterpart
# here. Self-test: `scripts/__tests__/bump-objectstack.test.ts` drives this file's
# real bytes over throwaway git repositories.
# --help ends here
#
# ^ SENTINEL, not prose -- `--help` prints from the shebang down to the line above
# and stops there, so the terminator travels with the text it terminates.
# Everything from here down is internal rationale and is NOT user-facing help.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBJECTSTACK_ROOT="${OBJECTSTACK_ROOT:-$(cd "${ROOT}/../objectstack" 2>/dev/null && pwd || true)}"
PIN_FILE="${ROOT}/.objectstack-sha"

NO_COMMIT=0
EXPLICIT_REV=""
for arg in "$@"; do
  case "$arg" in
    --no-commit) NO_COMMIT=1 ;;
    -h|--help)
      # A missing sentinel EXITS 1 rather than printing to EOF: a truncated help and
      # a complete one would both exit 0 and both print something.
      if ! grep -qxF '# --help ends here' "$0"; then
        echo "✗ ${0##*/}: the '# --help ends here' sentinel is missing -- cannot tell" >&2
        echo "  where the help text ends. Restore it at the end of the header block." >&2
        exit 1
      fi
      sed -n '2,/^# --help ends here$/p' "$0" \
        | grep -vxF '# --help ends here' \
        | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "✗ unknown option: ${arg} (see --help)" >&2
      exit 1
      ;;
    *) EXPLICIT_REV="$arg" ;;
  esac
done

# `-e`, not `-d`: in a git WORKTREE `.git` is a file holding a `gitdir:` pointer.
if [[ -z "${OBJECTSTACK_ROOT}" || ! -e "${OBJECTSTACK_ROOT}/.git" ]]; then
  if [[ -n "${OBJECTSTACK_ROOT}" ]]; then
    echo "✗ ${OBJECTSTACK_ROOT} is not a git checkout (no .git)" >&2
  else
    echo "✗ Cannot find an objectstack checkout at ${ROOT}/../objectstack" >&2
  fi
  echo "  Override with: OBJECTSTACK_ROOT=/path/to/objectstack scripts/bump-objectstack.sh" >&2
  exit 1
fi

# --- RESOLVE AND READ THE COMMIT BEFORE TOUCHING ANYTHING ---------------------
# The guard is the read itself, not a probe standing in for it: `git rev-parse
# HEAD` resolves the ref WITHOUT reading the object (a missing or unreadable
# commit object still prints a sha), and `cat-file -e` tests presence, not
# readability. `git log -1` reads the object, so anything that would fail later
# fails here, with the pin untouched.
REV="${EXPLICIT_REV:-HEAD}"
if ! NEW_SHA="$(git -C "$OBJECTSTACK_ROOT" rev-parse --verify --quiet "${REV}^{commit}")"; then
  {
    echo "✗ REFUSING to bump: '${REV}' does not resolve to a readable commit in"
    echo "  ${OBJECTSTACK_ROOT}."
    echo "  NOTHING WAS WRITTEN -- .objectstack-sha is untouched."
    echo "  Fetch it first:  git -C ${OBJECTSTACK_ROOT} fetch origin"
  } >&2
  exit 1
fi
SHORT="${NEW_SHA:0:12}"
if ! SUBJECT_LINE="$(git -C "$OBJECTSTACK_ROOT" log -1 --format=%s "$NEW_SHA")"; then
  {
    echo "✗ REFUSING to bump: the objectstack commit object ${SHORT} cannot be read in"
    echo "  ${OBJECTSTACK_ROOT}."
    echo "  'git log -1 --format=%s ${SHORT}' fails there, so there is nothing meaningful"
    echo "  to pin: no build of it could be made either."
    echo "  NOTHING WAS WRITTEN -- .objectstack-sha is untouched and still holds the old pin."
    echo "  Fetch or repair the objectstack object store, then re-run this bump:"
    echo "      git -C ${OBJECTSTACK_ROOT} fetch origin"
    echo "      git -C ${OBJECTSTACK_ROOT} cat-file -e ${SHORT}^{commit} && echo present"
  } >&2
  exit 1
fi

# --- Is the commit we are about to pin actually ON objectstack main? ----------
# A WARNING, NOT A GATE: `origin/main` in a local checkout is only as fresh as the
# last fetch, so refusing would reject a commit merged a minute ago. The build of
# the pin fetches the commit by sha from the objectstack remote, so a commit that
# was never pushed fails loudly there.
#
# THREE ANSWERS, NOT TWO. `merge-base --is-ancestor` exits 0 (ancestor), 1 (not an
# ancestor) and 128 on an error; a checkout with no `origin/main` cannot answer at
# all. Neither error is folded into either verdict.
REACH_TAG=""
REACH_RECALL=""

reach_ref_list() {
  local n="$#"
  if (( n == 0 )); then printf 'none'; return 0; fi
  local out
  out="$(printf '%s, ' "${@:1:10}")"
  out="${out%, }"
  if (( n > 10 )); then out="${out} … (+$(( n - 10 )) more; ${n} total)"; fi
  printf '%s' "$out"
}

report_reachability() {
  local sha="$1"
  local short="${sha:0:12}"
  local rc=0

  if ! git -C "$OBJECTSTACK_ROOT" rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    REACH_TAG=" (reachability UNKNOWN)"
    REACH_RECALL=" -- ⚠️ pin reachability UNKNOWN, see above"
    {
      echo
      echo "⚠️  COULD NOT DETERMINE whether ${short} is on objectstack main."
      echo "    ${OBJECTSTACK_ROOT} has no 'origin/main' ref, so the question cannot be asked"
      echo "    in this checkout at all."
      echo "    This is NOT 'the pin is fine' and NOT 'the pin left main'. It is unanswered,"
      echo "    and the pin is being written anyway."
      echo "    To make it answerable here:  git -C ${OBJECTSTACK_ROOT} fetch origin main"
      echo "    (not run for you -- this script stays usable offline.)"
      echo
    } >&2
    return 0
  fi

  git -C "$OBJECTSTACK_ROOT" merge-base --is-ancestor "$sha" origin/main 2>/dev/null || rc=$?

  if [[ "$rc" -eq 0 ]]; then
    REACH_TAG=" (on origin/main)"
    return 0
  fi

  if [[ "$rc" -ne 1 ]]; then
    REACH_TAG=" (reachability UNKNOWN)"
    REACH_RECALL=" -- ⚠️ pin reachability UNKNOWN, see above"
    {
      echo
      echo "⚠️  COULD NOT DETERMINE whether ${short} is on objectstack main."
      echo "    'git merge-base --is-ancestor ${short} origin/main' exited ${rc}; only 0"
      echo "    (is an ancestor) and 1 (is not) are verdicts. Anything else is an error,"
      echo "    and is reported as one rather than folded into either answer."
      echo "    In a shallow checkout a missing history reads this way: deepen it with"
      echo "    git -C ${OBJECTSTACK_ROOT} fetch --unshallow origin"
      echo
    } >&2
    return 0
  fi

  REACH_TAG=" (NOT on origin/main)"
  REACH_RECALL=" -- ⚠️ pin is NOT on objectstack origin/main, see above"

  # A read loop, not `mapfile`: this runs by hand on macOS, whose bash is 3.2.
  local -a local_refs=() remote_refs=()
  local ref_line=''
  while IFS= read -r ref_line; do
    if [[ -n "$ref_line" ]]; then local_refs+=("$ref_line"); fi
  done < <(
    git -C "$OBJECTSTACK_ROOT" for-each-ref --contains "$sha" --format='%(refname:short)' refs/heads 2>/dev/null || true
  )
  while IFS= read -r ref_line; do
    if [[ -n "$ref_line" ]]; then remote_refs+=("$ref_line"); fi
  done < <(
    git -C "$OBJECTSTACK_ROOT" for-each-ref --contains "$sha" --format='%(refname:short)' refs/remotes 2>/dev/null || true
  )

  local main_tip
  main_tip="$(git -C "$OBJECTSTACK_ROOT" log -1 --format='%h, committed %cr' origin/main 2>/dev/null || echo 'unknown')"

  {
    echo
    echo "⚠️  objectstack pin ${short} is NOT reachable from origin/main in"
    echo "    ${OBJECTSTACK_ROOT} -- it names a commit that is not on objectstack main."
    echo "    on local branches : $(reach_ref_list ${local_refs[@]+"${local_refs[@]}"})"
    echo "    on remote branches: $(reach_ref_list ${remote_refs[@]+"${remote_refs[@]}"})"
    if (( ${#remote_refs[@]} > 0 )); then
      echo "    → It IS pushed, but only onto branch(es) that have not merged into main."
    elif (( ${#local_refs[@]} > 0 )); then
      echo "    → It is on a LOCAL branch only -- the pinned build fetches it from the"
      echo "      objectstack remote by sha, so it fails until this commit is pushed."
    else
      echo "    → No branch in this checkout contains it (detached HEAD on a discarded commit?)."
    fi
    echo "    Or your origin/main is simply STALE: it points at ${main_tip}."
    echo "      Refresh it with:  git -C ${OBJECTSTACK_ROOT} fetch origin main"
    echo "      (not run for you -- this script stays usable offline, and the answer to"
    echo "       this question is yours to judge.)"
    echo "    Pinning it anyway."
    echo
  } >&2
  return 0
}

report_reachability "$NEW_SHA"

OLD_SHA='(none)'
if [[ -f "$PIN_FILE" ]]; then OLD_SHA="$(tr -d '[:space:]' < "$PIN_FILE")"; fi

print_next_step() {
  echo
  echo "→ NEXT STEP -- let pnpm link the build of ${SHORT}:"
  echo "      pnpm install             # commit pnpm-lock.yaml if this changes it"
  echo "  Then type-check and test against it. OBJECTSTACK_ROOT=<tree> pnpm objectstack:build"
  echo "  stands an existing objectstack tree in instead of the pin."
}

if [[ "$OLD_SHA" == "$NEW_SHA" ]]; then
  echo "→ Already at ${SHORT}${REACH_TAG}, nothing to do."
  exit 0
fi

# THE INVARIANT THAT MUST HOLD HERE: no read of the objectstack CHECKOUT happens
# below this point. Everything that can fail on such a read already ran, and
# refused, above. The build below fetches the commit by sha; when it fails, the
# old pin is put back byte for byte.
PIN_BACKUP="$(mktemp)"
trap 'rm -f "$PIN_BACKUP"' EXIT
if [[ -f "$PIN_FILE" ]]; then cp "$PIN_FILE" "$PIN_BACKUP"; fi
echo "$NEW_SHA" > "$PIN_FILE"
echo "→ objectstack pin: ${OLD_SHA:0:12} → ${SHORT}${REACH_TAG}"
echo "  ${SUBJECT_LINE}"

# `env -u`: OBJECTSTACK_ROOT names the checkout read above; reaching the build it
# would stand that tree in for the pin.
if ! (cd "$ROOT" && env -u OBJECTSTACK_ROOT node scripts/objectstack-pin.mjs build --write-manifests); then
  if [[ "$OLD_SHA" == '(none)' ]]; then rm -f "$PIN_FILE"; else cp "$PIN_BACKUP" "$PIN_FILE"; fi
  echo "✗ REFUSING to bump: the build of ${SHORT} failed (above). .objectstack-sha is restored; nothing was committed." >&2
  exit 1
fi

if [[ "$NO_COMMIT" -eq 1 ]]; then
  echo "→ --no-commit: leaving .objectstack-sha and .objectstack-pin unstaged${REACH_RECALL}."
  print_next_step
  exit 0
fi

git -C "$ROOT" add .objectstack-sha .objectstack-pin
git -C "$ROOT" commit -m "chore: bump objectstack to ${SHORT}

${SUBJECT_LINE}

objectstack@${NEW_SHA}" -- .objectstack-sha .objectstack-pin
echo "✓ Committed${REACH_RECALL}. Push with: git push"
print_next_step
