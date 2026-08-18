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

OLD_SHA="$(cat "${FRAMEWORK_ROOT}/.objectui-sha" 2>/dev/null | tr -d '[:space:]' || echo '<none>')"

if [[ "$OLD_SHA" == "$NEW_SHA" ]]; then
  echo "→ Already at ${NEW_SHA:0:12}, nothing to do."
  exit 0
fi

echo "$NEW_SHA" > "${FRAMEWORK_ROOT}/.objectui-sha"
echo "→ objectui pin: ${OLD_SHA:0:12} → ${NEW_SHA:0:12}"

SHORT="${NEW_SHA:0:12}"
SUBJECT_LINE="$(git -C "$OBJECTUI_ROOT" log -1 --format=%s "$NEW_SHA")"

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
  echo "→ --no-commit: leaving files unstaged."
  print_sdui_next_step
  exit 0
fi

git -C "$FRAMEWORK_ROOT" add .objectui-sha
[[ -n "$CS_FILE" ]] && git -C "$FRAMEWORK_ROOT" add "$CS_FILE"
git -C "$FRAMEWORK_ROOT" commit -m "chore: bump objectui to ${SHORT}

${SUBJECT_LINE}

objectui@${NEW_SHA}" -- .objectui-sha ${CS_FILE:+"$CS_FILE"}
echo "✓ Committed. Push with: git push"
print_sdui_next_step
