#!/usr/bin/env bash
# Bump the objectui SHA the framework workspace pins against.
#
# Usage:
#   scripts/bump-objectui.sh                # bump to current HEAD of ../objectui
#   scripts/bump-objectui.sh <sha>          # bump to an explicit SHA (or ref)
#   scripts/bump-objectui.sh --no-commit    # update files only, don't commit
#   scripts/bump-objectui.sh --no-changeset # skip the @objectstack/console changeset
#
# After the bump — the second half of the pin-update procedure (#5960):
#   pnpm sdui:manifest        # dump objectui's sdui.manifest.json and run the
#                             # spec↔registry declaration-parity ratchet (ADR-0082 D4).
#                             # The pin bump is that ratchet's ONLY trigger; it is an
#                             # on-demand gate by decision, never a CI job. Needs
#                             # Playwright chromium. This script prints the reminder.
#
# The pin must name a commit that is on objectui MAIN. This script WARNS — it
# does not refuse — when the revision being pinned is not reachable from the
# objectui checkout's `origin/main`, and names the branch(es) it IS on. It never
# fetches for you: `origin/main` is only as fresh as your last fetch and this
# script stays usable offline. The release cut re-asks the same question against
# a fresh full clone and REFUSES to cut (#9450). Three answers, never two — a
# checkout that cannot answer the question says so rather than guessing (#10495).
#
# It DOES refuse — before writing anything — when the commit object cannot be
# read in the objectui checkout at all. There is nothing meaningful to pin, and a
# failed run must leave no half-applied state: `.objectui-sha` is byte-identical
# to what it was before the run (#10797).
#
# Env:
#   CONSOLE_BUMP=major|minor|patch  # force the changeset bump type (default: auto —
#                             # the HIGHEST level objectui itself declared in the
#                             # changesets added over the range; see #4731)
#   CONSOLE_CHANGES_MAX=<n>   # cap the rendered list (default 100). A cap that
#                             # fires says so, with the real count — never silently.
#   OBJECTUI_NO_DEEPEN=1      # do NOT run 'git fetch --unshallow' on the objectui
#                             # checkout when the pin range is truncated inside it.
#                             # Default is to deepen: measured on objectui the fetch
#                             # costs ~6s and ~4MB and turns a 110-commit walk into
#                             # the true 191 (#9408). Set this offline, or when the
#                             # checkout must not be touched — the bump then takes
#                             # the DEGRADED path and says why.
#
# Assumes sibling layout:
#   ~/work/objectui
#   ~/work/objectstack   ← run from here
# --help ends here
#
# ^ SENTINEL, not prose — `--help` prints from the shebang down to the line above
# and stops there, so the terminator travels with the text it terminates. Add or
# remove header lines freely; no line number tracks this block any more (#6425).
# Spell it exactly: the --help branch below refuses to run without it. Everything
# from here down is internal rationale and is NOT user-facing help.
#
# objectui ships @object-ui/console as a static SPA. The framework
# release pipeline reads .objectui-sha, clones objectui at that commit,
# builds @object-ui/console, and copies dist/ into
# packages/console/ so @objectstack/console publishes a frozen,
# version-matched build alongside the rest of the framework.
#
# The frontend is a version-locked package too, but a SHA bump alone left no
# trace in the release history — @objectstack/console's CHANGELOG stayed empty
# across frontend-only updates. So this bump also emits a changeset summarizing
# the objectui commit range, routing the frontend delta through the SAME
# changesets pipeline as the backend: it lands in @objectstack/console's
# CHANGELOG and rolls up into the platform version + the curated release notes.
#
# WHAT GOES IN THE LIST — DECLARED, NOT GUESSED (#4731)
# The list used to be a GUESS off the commit subject (`grep -iE '^- (feat|fix)'`
# + `head -40`), and the bump level another (`grep -ciE '^feat'`). Both were
# measured wrong on one real range: every `refactor(...)!` — the BREAKING class,
# the one that must never vanish from a release record — was structurally unable
# to appear, `head -40` truncated in silence, and `fix(ci)` commits that release
# nothing were pulled in. objectui already DECLARES which commits ship: every
# releasing PR carries a `.changeset/*.md`, and an empty frontmatter block is
# changesets' own "release-nothing". So `objectui-changeset-digest.mjs` reads the
# changesets added over the range — package names decide inclusion, the declared
# level decides the bump. Nothing is inferred from a subject line.
#
# SELF-TEST: `scripts/bump-objectui.selftest.sh` (`pnpm check:objectui-bump`,
# run unconditionally by the lint job). It drives this file's real bytes over
# throwaway git repos and pins the write-ordering invariant of #10797 — an
# unreadable commit object refuses and leaves `.objectui-sha` byte-identical —
# plus two readable-commit cases, so a guard that refused everything would fail
# it. Offline, no node, ~1s. Reordering anything between the reads above the
# first mutation and that mutation is what it exists to catch.

set -euo pipefail

FRAMEWORK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBJECTUI_ROOT="${OBJECTUI_ROOT:-$(cd "${FRAMEWORK_ROOT}/../objectui" 2>/dev/null && pwd || true)}"

NO_COMMIT=0
NO_CHANGESET=0
EXPLICIT_SHA=""
for arg in "$@"; do
  case "$arg" in
    --no-commit) NO_COMMIT=1 ;;
    --no-changeset) NO_CHANGESET=1 ;;
    -h|--help)
      # The header block above IS the help text, and the `# --help ends here`
      # sentinel is what ends it — no line range, so growing the header can no
      # longer truncate the help (#6425; #5960 grew it and PR #6421 had to move a
      # hand-kept `2,26p`). The leading `2` addresses the shebang, whose position
      # is fixed by execve rather than by the header's content, so it cannot drift.
      #
      # A missing sentinel EXITS 1 rather than running on to EOF: a truncated help
      # and a complete one both exit 0 and both print something, which is precisely
      # why the old coupling could fail in silence — same lesson as the `head -40`
      # this script used to truncate its changeset list with (#4731). Guarded here,
      # not at startup: a deleted comment must never stop an actual pin bump.
      if ! grep -qxF '# --help ends here' "$0"; then
        echo "✗ ${0##*/}: the '# --help ends here' sentinel is missing — cannot tell" >&2
        echo "  where the help text ends. Restore it at the end of the header block." >&2
        exit 1
      fi
      sed -n '2,/^# --help ends here$/p' "$0" \
        | grep -vxF '# --help ends here' \
        | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) EXPLICIT_SHA="$arg" ;;
  esac
done

# `-e`, not `-d`: in a git WORKTREE `.git` is a regular file holding a `gitdir:`
# pointer, so a `-d` test rejected every linked worktree — and AGENTS.md requires
# one per task, so this rejected the mandated workflow and only ever worked from a
# primary clone.
if [[ -z "${OBJECTUI_ROOT}" || ! -e "${OBJECTUI_ROOT}/.git" ]]; then
  if [[ -n "${OBJECTUI_ROOT}" ]]; then
    echo "✗ ${OBJECTUI_ROOT} is not a git checkout (no .git)"
  else
    echo "✗ Cannot find objectui checkout at ${FRAMEWORK_ROOT}/../objectui"
  fi
  echo "  Override with: OBJECTUI_ROOT=/path/to/objectui scripts/bump-objectui.sh"
  exit 1
fi

if [[ -n "$EXPLICIT_SHA" ]]; then
  NEW_SHA="$(git -C "$OBJECTUI_ROOT" rev-parse "$EXPLICIT_SHA^{commit}")"
else
  NEW_SHA="$(git -C "$OBJECTUI_ROOT" rev-parse HEAD)"
fi

# --- READ THE COMMIT BEFORE TOUCHING ANYTHING (#10797) -----------------------
# Everything this bump reads OUT of the objectui commit is read here, ahead of
# the first mutation of `.objectui-sha`. The ordering is the whole point. The pin
# write used to come first and `git log -1 --format=%s` second, so an unreadable
# commit object killed the run under `set -e` with the pin file ALREADY
# REWRITTEN: no changeset, no commit, a bare `fatal: bad object` as the entire
# explanation, and a working tree the operator had to clean up by hand. Nor did
# re-running self-correct — the pin file now held the bad SHA, so the next run
# compared against it. Measured, git 2.43.0, on a throwaway objectui whose HEAD
# commit object was deleted: `SCRIPT EXIT=128`, `.objectui-sha` modified. The
# invariant restored here is "a failed run leaves no half-applied state".
#
# THE GUARD IS THE READ ITSELF, not a probe standing in for it. `cat-file -e`
# answers "is the object present", which is one failure short of the question
# that matters: a present-but-unreadable object (corrupt zlib, truncated pack)
# passes it and still kills `git log`. Performing the real read means anything
# that would have failed later has already failed HERE, with the tree untouched.
# One implementation of the rule, and it is the rule — the same reason the range
# walk is asked inside the digest rather than copied into this shell (#9408).
#
# AND IT REFUSES RATHER THAN WARNS. The #10495 warning-not-gate ruling below is
# about a pin that is not on `origin/main` — a real commit you can still
# meaningfully pin, where `origin/main` may simply be stale and the judgement is
# the operator's. This is a pin whose object cannot be read AT ALL: there is
# nothing to pin, nothing for the operator to weigh, and neither the changeset
# entry nor the commit message can be derived from it. Warning here would only
# reinstate the half-applied write. (#10797 triage ruling, 2026-08-21.)
#
# Reachable from the DEFAULT path, not just from an explicit argument. Measured,
# git 2.43.0: `git rev-parse HEAD` exits **0** and prints the sha even when that
# commit object is missing from the object store — it resolves the ref, it does
# not read the object. A partial clone with the object not fetched, or an
# interrupted object store, gets here with no argument at all.
#
# git's own `fatal:` is left on stderr deliberately: it names WHICH failure this
# was, and the block below is the explanation it was missing — not a replacement
# for it.
SHORT="${NEW_SHA:0:12}"
if ! SUBJECT_LINE="$(git -C "$OBJECTUI_ROOT" log -1 --format=%s "$NEW_SHA")"; then
  {
    echo "✗ REFUSING to bump: the objectui commit object ${SHORT} cannot be read in"
    echo "  ${OBJECTUI_ROOT}."
    echo "  'git log -1 --format=%s ${SHORT}' fails there, so this bump can derive neither"
    echo "  the @objectstack/console changeset nor the commit message from it — there is"
    echo "  nothing meaningful to pin."
    echo "  A ref can name a commit whose object is missing: 'git rev-parse' resolves the"
    echo "  ref WITHOUT reading the object, so a plain HEAD bump reaches this too, not just"
    echo "  an explicit argument."
    echo "  NOTHING WAS WRITTEN — .objectui-sha is untouched and still holds the old pin."
    echo "  Fetch or repair the objectui object store, then re-run this bump:"
    echo "      git -C ${OBJECTUI_ROOT} fetch origin"
    echo "      git -C ${OBJECTUI_ROOT} cat-file -e ${SHORT}^{commit} && echo present"
  } >&2
  exit 1
fi

# --- Is the revision we are about to pin actually ON objectui main? (#10495) --
# `rev-parse HEAD` answers "what is checked out", never "is it on main". Bump
# with a feature branch checked out — or pass a branch name — and the pin names
# a revision that is not on main, and this script used to report success.
# Measured on a fresh `--no-tags` clone of objectui, 2026-08-21: 941 remote
# branches, 118 branch tips not reachable from `main`, 291 commits present and
# not on main. Any of those is one `rev-parse HEAD` away from being the pin.
#
# A WARNING, NOT A GATE — deliberately, and the split is with #9450 / PR #10494:
# `.github/workflows/cut-rc.yml` now runs this same predicate against a fresh
# full clone and refuses to cut. That is the chokepoint that must fail closed.
# Here it must not: `origin/main` in a local checkout is only as fresh as the
# last fetch, so hard-failing would reject a legitimately-just-merged commit,
# and this script is deliberately usable offline and on a machine that cannot
# run the full procedure (same rationale as `print_sdui_next_step`). So: say it
# loudly, name the branch it IS on, and let the operator decide. Never fetch on
# the operator's behalf — unlike the `--unshallow` deepen below, which repairs
# an input this script is about to DERIVE from, a fetch here would only change
# the answer to a question the operator is being asked to judge.
#
# THREE ANSWERS, NOT TWO. `merge-base --is-ancestor` exits 0 (ancestor), 1 (not
# an ancestor) and **128 on an absent object** — an error, not a verdict.
# Measured, git 2.43.0:
#     git merge-base --is-ancestor <absent-sha> origin/main
#     fatal: Not a valid commit name <absent-sha>          -> exit 128
# Reading 128 as "not an ancestor" invents a false alarm; reading anything that
# is not 1 as "fine" reinstates exactly the silent pass this check exists to
# remove. A checkout with no `origin/main` cannot answer the question at all.
# So the exits are split three ways, and the third says what it could not
# determine and why — it never borrows the wording of either verdict.
#
# The absent-object case is reachable from the DEFAULT path, not just from an
# explicit argument. Measured, git 2.43.0: `git rev-parse HEAD` exits **0** and
# prints the sha even when that commit object is missing from the object store —
# it resolves the ref, it does not read the object. So a resolved NEW_SHA is not
# proof the object is present; that question is settled ABOVE, before anything is
# written, as a refusal rather than as a report (#10797).
REACH_TAG=""      # parenthetical for the one line that is printed anyway
REACH_RECALL=""   # tail recall, so a warning cannot scroll out of the run

# Render at most 10 ref names. A cap that fires SAYS SO, with the real count —
# a capped list that reads as complete is this file's other standing lesson
# (CONSOLE_CHANGES_MAX, #4731).
reach_ref_list() {
  local n="$#"
  if (( n == 0 )); then printf 'none'; return 0; fi
  local out
  out="$(printf '%s, ' "${@:1:10}")"
  out="${out%, }"
  if (( n > 10 )); then out="${out} … (+$(( n - 10 )) more; ${n} total)"; fi
  printf '%s' "$out"
}

report_objectui_reachability() {
  local sha="$1"
  local short="${sha:0:12}"
  local rc=0

  # Q1 — can this checkout answer the question AT ALL? Asked first because the
  # later questions are meaningless without it: with no origin/main,
  # `--is-ancestor` would report "the pin left main", which is this check's own
  # overclaim wearing a new message.
  if ! git -C "$OBJECTUI_ROOT" rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    REACH_TAG=" (reachability UNKNOWN)"
    REACH_RECALL=" — ⚠️ pin reachability UNKNOWN, see above"
    {
      echo
      echo "⚠️  COULD NOT DETERMINE whether ${short} is on objectui main."
      echo "    ${OBJECTUI_ROOT} has no 'origin/main' ref, so the question cannot be asked"
      echo "    in this checkout at all."
      echo "    This is NOT 'the pin is fine' and NOT 'the pin left main'. It is unanswered,"
      echo "    and the pin is being written anyway."
      echo "    To make it answerable here:  git -C ${OBJECTUI_ROOT} fetch origin main"
      echo "    (not run for you — this script stays usable offline.)"
      echo "    The release cut re-asks it against a fresh full clone and fails closed (#9450)."
      echo
    } >&2
    return 0
  fi

  # Q2 — whether the object can be READ is deliberately NOT asked here. It is
  # settled up front, by the read this bump actually needs (`git log -1
  # --format=%s`), and an unreadable object REFUSES there with the working tree
  # untouched (#10797) — so `--is-ancestor` below cannot meet an absent object on
  # any path that reaches this function. Asking it a second time with a weaker
  # probe (`cat-file -e` tests presence, not readability) would be a second
  # implementation of one rule, free to drift from the thing it guards. If that
  # ordering is ever broken, the rc-is-not-1 branch below is the backstop: it
  # reports 128 as the error it is and never as a verdict.

  # Q3 — the verdict. 0 / 1 / anything else, distinguished on purpose.
  git -C "$OBJECTUI_ROOT" merge-base --is-ancestor "$sha" origin/main 2>/dev/null || rc=$?

  if [[ "$rc" -eq 0 ]]; then
    # Reachable. No banner — but the line that prints anyway says so, so that
    # "checked, and fine" is stated rather than inferred from silence.
    REACH_TAG=" (on origin/main)"
    return 0
  fi

  if [[ "$rc" -ne 1 ]]; then
    REACH_TAG=" (reachability UNKNOWN)"
    REACH_RECALL=" — ⚠️ pin reachability UNKNOWN, see above"
    {
      echo
      echo "⚠️  COULD NOT DETERMINE whether ${short} is on objectui main."
      echo "    'git merge-base --is-ancestor ${short} origin/main' exited ${rc}; only 0"
      echo "    (is an ancestor) and 1 (is not) are verdicts. Anything else is an error,"
      echo "    and is being reported as one rather than folded into either answer."
      echo "    This is NOT 'the pin is fine' and NOT 'the pin left main'. It is unanswered."
      echo
    } >&2
    return 0
  fi

  # rc == 1: a real verdict, and the one this card exists for.
  REACH_TAG=" (NOT on origin/main)"
  REACH_RECALL=" — ⚠️ pin is NOT on objectui origin/main, see above"

  # Enumerated only on this branch: with ~941 branches a --contains walk is not
  # free, and the healthy path must not pay for it.
  #
  # READ LOOP, NOT `mapfile` — THE BASH 3.2 FLOOR. `mapfile`/`readarray` are
  # bash 4 builtins, and `/usr/bin/env bash` is bash 3.2.57 on macOS (Apple has
  # not shipped bash 4+ for licensing reasons). This script is run BY HAND, BY
  # AN OPERATOR, on a laptop — the pin-bump procedure in
  # `docs/releases-maintenance.md` has no CI path — so a bash-4 builtin here
  # does not fail on a fringe host, it fails on the ordinary one. And it fails
  # on exactly the branch that must not fail: `mapfile` is only ever reached
  # once the verdict is "NOT on origin/main", i.e. the #10495 warning is the
  # single thing this shell cannot deliver. Measured with `mapfile` disabled:
  # `mapfile: command not found`, then `set -e` kills the run at status
  # 127 BEFORE the pin is written, and the operator is handed a bare builtin
  # error where the warning should have been — an error whose obvious remedy
  # (edit `.objectui-sha` by hand) walks around every guard in this file.
  # CI runs bash 5, so neither the defect nor this repair is observable in a
  # normal CI run; the digest self-test pins it with the builtin disabled
  # (`enable -n mapfile readarray` via `BASH_ENV`) plus a static scan.
  # Keep this loop bash-3.2-clean: no `mapfile`, no `readarray`, no
  # `declare -A`, no `${x^^}`/`${x,,}`. The `if` (rather than `[[ … ]] &&`) is
  # load-bearing under `set -e` — but NOT on an empty ref list: an all-empty
  # read leaves the loop body unexecuted and the `while` exits 0 either way
  # (measured, bash 5.2.21). The real trap is a NON-EMPTY read whose LAST
  # line fails the `[[ -n … ]]` test, and only once that loop is the LAST
  # command of a function: the `&&`-list's false status becomes the loop's
  # exit status, which becomes the function's return, which `set -e` then
  # kills the caller on. Measured over all four combinations (empty vs.
  # non-empty-with-failing-last-line × loop-is-fn's-last-command vs. not):
  # only that one combination dies (exit 1); the other three exit 0.
  local -a local_refs=() remote_refs=()
  local ref_line=''
  while IFS= read -r ref_line; do
    if [[ -n "$ref_line" ]]; then local_refs+=("$ref_line"); fi
  done < <(
    git -C "$OBJECTUI_ROOT" for-each-ref --contains "$sha" --format='%(refname:short)' refs/heads 2>/dev/null || true
  )
  while IFS= read -r ref_line; do
    if [[ -n "$ref_line" ]]; then remote_refs+=("$ref_line"); fi
  done < <(
    git -C "$OBJECTUI_ROOT" for-each-ref --contains "$sha" --format='%(refname:short)' refs/remotes 2>/dev/null || true
  )

  local main_tip
  main_tip="$(git -C "$OBJECTUI_ROOT" log -1 --format='%h, committed %cr' origin/main 2>/dev/null || echo 'unknown')"

  {
    echo
    echo "⚠️  objectui pin ${short} is NOT reachable from origin/main in"
    echo "    ${OBJECTUI_ROOT} — it names a revision that is not on objectui main."
    echo "    on local branches : $(reach_ref_list ${local_refs[@]+"${local_refs[@]}"})"
    echo "    on remote branches: $(reach_ref_list ${remote_refs[@]+"${remote_refs[@]}"})"
    # Which of the two situations this is, said out loud, so the operator does
    # not have to go and look: a branch that never merged and a commit that was
    # never pushed take different remedies.
    if (( ${#remote_refs[@]} > 0 )); then
      echo "    → It IS pushed, but only onto branch(es) that have not merged into main."
    elif (( ${#local_refs[@]} > 0 )); then
      echo "    → It is on a LOCAL branch only — this commit has not been pushed to objectui."
    else
      echo "    → No branch in this checkout contains it (detached HEAD on a discarded commit?)."
    fi
    echo "    Or your origin/main is simply STALE: it points at ${main_tip}."
    echo "      Refresh it with:  git -C ${OBJECTUI_ROOT} fetch origin main"
    echo "      (not run for you — this script stays usable offline, and the answer to"
    echo "       this question is yours to judge.)"
    echo "    Pinning it anyway. Downstream: the release cut re-asks this against a fresh"
    echo "    full clone and REFUSES to cut (#9450), so a bad pin surfaces at RC time at"
    echo "    the earliest; until then 'pnpm sdui:manifest' would ratchet spec↔registry"
    echo "    declaration parity against a tree that is not on main (ADR-0082 D4)."
    echo
  } >&2
  return 0
}

report_objectui_reachability "$NEW_SHA"

OLD_SHA="$(cat "${FRAMEWORK_ROOT}/.objectui-sha" 2>/dev/null | tr -d '[:space:]' || echo '<none>')"

if [[ "$OLD_SHA" == "$NEW_SHA" ]]; then
  echo "→ Already at ${NEW_SHA:0:12}${REACH_TAG}, nothing to do."
  exit 0
fi

# FIRST MUTATION OF THE WORKING TREE. Everything read out of the objectui commit
# was read above, and an unreadable commit already refused — nothing below this
# line can fail on a read of `$NEW_SHA` that has not already been attempted
# (#10797). Keep it that way: a new `git -C "$OBJECTUI_ROOT" …` added after this
# point re-opens exactly the half-applied write this ordering exists to prevent.
echo "$NEW_SHA" > "${FRAMEWORK_ROOT}/.objectui-sha"
echo "→ objectui pin: ${OLD_SHA:0:12} → ${NEW_SHA:0:12}${REACH_TAG}"

# --- Emit the @objectstack/console changeset for the frontend delta ----------
CS_FILE=""
if [[ "$NO_CHANGESET" -eq 0 ]]; then
  # Can we walk the OLD..NEW range in the objectui checkout? (A shallow clone or
  # a first-ever pin may not have OLD reachable — degrade to the tip subject,
  # and SAY SO in the artifact: a degraded list and a complete one must never
  # look alike, #4731.)
  #
  # THE TEST IS WALK COMPLETENESS, NOT OBJECT PRESENCE (#9408). It used to be
  # `git cat-file -e OLD_SHA` — "does the OLD endpoint exist" — which is a
  # different question, and the gap between them is measured: on the bump that
  # landed `.changeset/console-82a94170c405.md` that test PASSED against a
  # history truncated at commit 110 of 191, so this guard set RANGE_OK=1, the
  # degraded path below never fired, and the digest exited 0 on a record
  # crediting 36 of its 119 entries to one commit that adds exactly one. A
  # truncated history is worse than an absent endpoint precisely because it
  # ANSWERS: git shows its oldest visible commit as parentless, diffs it against
  # the empty tree, and that one commit absorbs a whole batch.
  #
  # The question is asked IN THE DIGEST (`--check-walkable`) so there is one
  # implementation of the rule rather than a shell copy that can drift from the
  # thing it guards — see `findRangeTruncation`. Exit 2 = an endpoint is missing,
  # 3 = the endpoints are here but the history stops inside the range.
  range_walkable() {
    node "${FRAMEWORK_ROOT}/scripts/objectui-changeset-digest.mjs" \
      --objectui-root "$OBJECTUI_ROOT" --from "$1" --to "$2" --check-walkable
  }

  RANGE_OK=0
  TRUNCATED=0
  if [[ "$OLD_SHA" != "<none>" ]]; then
    WALK_RC=0
    range_walkable "$OLD_SHA" "$NEW_SHA" || WALK_RC=$?
    if [[ "$WALK_RC" -eq 0 ]]; then
      RANGE_OK=1
    elif [[ "$WALK_RC" -eq 3 ]]; then
      TRUNCATED=1
      # REPAIR THE INPUT BEFORE LABELLING A DERIVATION OF IT. A console changeset
      # becomes published CHANGELOG text, so a degraded record is permanent —
      # while the correct history is one fetch away and cheap: measured on
      # objectui, `fetch --unshallow` costs ~6s and ~4MB and takes the walk from
      # 110 commits to the true 191. The fetch is ADDITIVE by construction (it
      # adds objects and drops .git/shallow; it moves no branch and touches no
      # working tree), which is what makes doing it on the operator's checkout
      # defensible rather than presumptuous. Announced before and after, and
      # skippable with OBJECTUI_NO_DEEPEN=1 for an offline run.
      if [[ "${OBJECTUI_NO_DEEPEN:-0}" == "1" ]]; then
        echo "→ objectui history is truncated inside the range; OBJECTUI_NO_DEEPEN=1, not deepening." >&2
      elif [[ "$(git -C "$OBJECTUI_ROOT" rev-parse --is-shallow-repository 2>/dev/null)" != "true" ]]; then
        # Not shallow, yet the walk stops: a graft, a `git replace`, or unrelated
        # histories. `--unshallow` cannot repair those and errors out on a
        # complete repository, so do not pretend it might.
        echo "→ objectui history is truncated inside the range but the clone is NOT shallow" >&2
        echo "  (graft, git replace, or unrelated histories) — 'fetch --unshallow' cannot repair that." >&2
      else
        # RE-CHECK, never trust the fetch's exit code. Measured: `git fetch
        # --unshallow` in a checkout with no remote configured exits 0 and
        # changes nothing at all, so a status-only test would set RANGE_OK=1 on
        # a still-truncated tree — this card's failure, one layer further in.
        echo "→ objectui is a shallow clone and the pin range is truncated inside it — deepening…"
        DEEPEN_RC=0
        git -C "$OBJECTUI_ROOT" fetch --unshallow || DEEPEN_RC=$?
        if [[ "$DEEPEN_RC" -eq 0 ]]; then
          WALK_RC=0
          range_walkable "$OLD_SHA" "$NEW_SHA" || WALK_RC=$?
          if [[ "$WALK_RC" -eq 0 ]]; then
            RANGE_OK=1
            TRUNCATED=0
            echo "✓ deepened — the range walks completely now."
          fi
        else
          echo "✗ 'git fetch --unshallow' failed (exit ${DEEPEN_RC}) — falling back to the degraded path." >&2
        fi
      fi
    fi
  fi

  CS_FILE="${FRAMEWORK_ROOT}/.changeset/console-${SHORT}.md"
  DIGEST_OK=0
  BUMP=""
  if [[ "$RANGE_OK" -eq 1 ]]; then
    # The digest reads objectui's OWN declarations (.changeset/*.md added over
    # the range) — inclusion and level both come from there, nothing is guessed
    # off a commit subject. It writes the whole changeset file and echoes the
    # resolved bump level.
    if BUMP="$(node "${FRAMEWORK_ROOT}/scripts/objectui-changeset-digest.mjs" \
        --objectui-root "$OBJECTUI_ROOT" \
        --framework-root "$FRAMEWORK_ROOT" \
        --from "$OLD_SHA" --to "$NEW_SHA" \
        --max "${CONSOLE_CHANGES_MAX:-100}" \
        --bump-override "${CONSOLE_BUMP:-}" \
        --out "$CS_FILE")"; then
      DIGEST_OK=1
    fi
  fi

  if [[ "$DIGEST_OK" -eq 0 ]]; then
    # Degraded path: no walkable range (initial pin, shallow clone, or the
    # digest could not run). Emit the tip subject ONLY, labelled as degraded —
    # the reader must be able to tell this list from a derived one.
    BUMP="${CONSOLE_BUMP:-patch}"
    RANGE_LABEL="${OLD_SHA:0:12}...${NEW_SHA:0:12}"
    WHY="the range \`${RANGE_LABEL}\` could not be walked in this objectui checkout"
    if [[ "$OLD_SHA" == "<none>" ]]; then
      RANGE_LABEL="(initial pin) → ${NEW_SHA:0:12}"
      WHY="this is the initial pin, so there is no previous SHA to walk from"
    elif [[ "${TRUNCATED:-0}" -eq 1 ]]; then
      # A degraded list must be distinguishable from a complete one (#4731); a
      # TRUNCATED range must further be distinguishable from an ABSENT endpoint,
      # because the two take different remedies and only one of them is a fetch
      # away. Naming the remedy here is the difference between a reader who
      # re-runs the bump correctly and one who edits the table by hand.
      WHY="the objectui history at \`${OBJECTUI_ROOT}\` STOPS INSIDE the range \`${RANGE_LABEL}\`, so \
walking it would credit a whole batch of upstream releases to the single commit where the \
history is cut off (objectstack#9408). Deepen the checkout — \`git -C ${OBJECTUI_ROOT} fetch \
--unshallow\` — and re-run this bump to get the real list"
    fi
    cat > "$CS_FILE" <<EOF
---
"@objectstack/console": ${BUMP}
---

Console (objectui) refreshed to \`${SHORT}\`. Frontend changes in this range:

⚠️ **Degraded list** — ${WHY}, so this entry could not be derived from the
changesets objectui declared. It names the tip commit only and is NOT a
complete account of the range:

- ${SUBJECT_LINE}

objectui range: \`${RANGE_LABEL}\`
EOF
  fi
  echo "→ wrote changeset $(basename "$CS_FILE") (@objectstack/console: ${BUMP})"
fi

# --- The other half of the pin-update procedure (#5960) ----------------------
# ADR-0082 D4's spec↔registry declaration-parity ratchet reads objectui's
# `sdui.manifest.json`, and that file changes when — and only when — this pin
# moves. So the pin bump is the ratchet's trigger, and it is the ONLY one:
# measured on origin/main, no workflow runs `pnpm sdui:manifest`, no workflow
# installs Playwright for it, `packages/console/dist/` is gitignored and the
# published @objectstack/console tarball ships no manifest. Producing it in this
# repo's CI was considered and REJECTED (#5960) — it would put a full objectui
# build plus a chromium download on every matching PR.
#
# Deliberately a REMINDER, not a hard gate: a machine without Playwright must
# still be able to move the pin, and hard-failing here would be the rejected
# CI cost wearing a local disguise. The gate itself cannot go falsely green —
# since #4690 a missing or unusable manifest exits 1 instead of skipping — so
# the only failure mode left is "nobody ran it", which is what this prints to
# prevent. Printed on BOTH exits below: --no-commit still moved the pin.
print_sdui_next_step() {
  echo
  echo "→ NEXT STEP — run the declaration-parity ratchet (ADR-0082 D4):"
  echo "      pnpm sdui:manifest"
  echo "  It rebuilds objectui at the new pin, dumps packages/console/dist/sdui.manifest.json"
  echo "  and ratchets spec↔registry declaration parity. A pin bump is its only trigger:"
  echo "  it is an on-demand gate by decision (#5960), never a CI job."
  echo "  Needs a Playwright browser — 'pnpm exec playwright install chromium-headless-shell'."
  echo "  Procedure: docs/releases-maintenance.md → 'After the pin moves'."
}

if [[ "$NO_COMMIT" -eq 1 ]]; then
  echo "→ --no-commit: leaving files unstaged${REACH_RECALL}."
  print_sdui_next_step
  exit 0
fi

git -C "$FRAMEWORK_ROOT" add .objectui-sha
[[ -n "$CS_FILE" ]] && git -C "$FRAMEWORK_ROOT" add "$CS_FILE"
git -C "$FRAMEWORK_ROOT" commit -m "chore: bump objectui to ${SHORT}

${SUBJECT_LINE}

objectui@${NEW_SHA}" -- .objectui-sha ${CS_FILE:+"$CS_FILE"}
echo "✓ Committed${REACH_RECALL}. Push with: git push"
print_sdui_next_step
