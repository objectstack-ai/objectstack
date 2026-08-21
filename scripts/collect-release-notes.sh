#!/usr/bin/env bash
# Collect the raw material for a release-notes page in content/docs/releases/.
#
# The platform spans three repositories; a release page must aggregate all of
# them. For the release between two framework refs this prints:
#   1. ALL framework commits in the range (feat/fix first). Changesets are a
#      curated subset — commits land without one, so the full log is the
#      source of truth for coverage.
#   2. The changesets consumed by the release (full text — the best prose for
#      items that have one).
#   3. The objectui (Console UI) commit range, derived from the .objectui-sha
#      pin at each ref.
#   4. The cloud (control plane) commits inside the release's time window.
#      Cloud is not pinned by the framework (it tracks it via link: deps and
#      versions independently), so the window between the two refs' commit
#      dates is the best available scope — review its edges by hand.
#
# Usage:
#   scripts/collect-release-notes.sh <prev-ref> [<new-ref>]
#   scripts/collect-release-notes.sh "@objectstack/spec@8.0.1" "@objectstack/spec@9.0.0"
#   scripts/collect-release-notes.sh "@objectstack/spec@9.0.0"        # new-ref defaults to HEAD
#
# Output is markdown on stdout — pipe it to a file and write the curated
# release page from it:
#   scripts/collect-release-notes.sh "@objectstack/spec@9.0.0" > /tmp/v10-material.md
#
# Sibling checkouts are found at ../objectui and ../cloud; override with
# OBJECTUI_ROOT / CLOUD_ROOT.
#
# Self-test:  scripts/collect-release-notes.sh --self-test   (temp fixtures, no network)
#
# ## Two sections ask a history question a shallow checkout answers WRONGLY
#
# Sections 1 and 3 ask range questions whose endpoints must both be objects
# (`<ref>..<ref>`): a missing endpoint is a `fatal: bad object` and `set -e`
# stops the script. Sections 2 and 4 have no such stop — in two different ways —
# so each carries a horizon guard. This script has no CI caller at all; it runs
# at release time from a seat, and section 4 reads a cloud checkout it does not
# own.
#
# ### Section 4 — a WINDOWED question (#9902)
#
# `git log --since/--until` over a shallow checkout answers from whatever part
# of the window is present, exits 0, and prints no warning.
#
# Measured on a depth-5 fixture whose true answer for the window is 21 commits:
# the shallow clone printed **5**, exit 0, under the same "### feat / fix"
# heading — sixteen release-note items missing with nothing to indicate it. So
# the section is WITHHELD rather than printed short: the consumer here is a
# human writing a release page, and a short list is indistinguishable from a
# quiet release, while an absent one cannot be transcribed by accident.
#
# `git-history.mjs ensure --no-fetch` is the shared predicate (the same one
# `check-governed-merges.mjs` and `check-engine-split-ratio.mjs` call), not a
# re-implementation: it asks whether the shallow floor predates the window
# rather than whether the clone is shallow, so a shallow cloud checkout with
# enough depth still prints its section. Deepening is left to the operator —
# this script must not reach into someone else's checkout and move it.
#
# ### Section 2 — a RANGE question whose endpoints both resolve (#10509)
#
# `git log --diff-filter=D PREV..NEW` looks safe because both endpoints are
# named — but an endpoint that RESOLVES does not make the range WALKABLE
# (#9450). A clone holding PREV as its own shallow island, the shape that
# `git fetch --shallow-since` and `git fetch --depth=1 origin <tag>` both
# produce, walks down from NEW, stops at its graft, and exits 0: every changeset
# consumed below that floor is simply absent from the list.
#
# Measured on this file's own 40-commit fixture (`--self-test`), two changesets
# consumed in the range: the complete clone lists **2**, a depth-12 clone
# holding PREV as an island lists **1** — both exit 0, both under this same
# heading. And when the floor sits above every deletion the list comes back
# empty, at which point the stock "_None found — is NEW_REF past the 'chore:
# version packages' commit?_" line printed a plausible WRONG diagnosis, sending
# the operator to check their arguments instead of their clone. So section 2 is
# withheld on the same terms as section 4, through the same predicate.
#
# The filing card predicted a different failure here — the per-file
# `git show "$(git log -1 NEW -- $f)~1:$f" || git show "PREV:$f"` fallback
# quietly serving the PREV copy — and that route does NOT reproduce. It is
# structurally closed: a file reaches the list only when its deleting commit is
# ABOVE the graft, and such a commit always has its parent present, so the
# primary lookup cannot fail for a file that is IN the list; at the boundary
# itself git reports the whole tree as ADDED, never DELETED, so the file drops
# out of the list instead of reaching the fallback (measured at clone depths
# 5/8/9/10/11/12/15/25). The harm it named is real all the same — the PREV copy
# IS the pre-edit prose for a changeset edited during the cycle — so the
# fallback is gone rather than guarded: every body now names the object it was
# read from, and one that cannot be resolved is withheld, not substituted.

set -euo pipefail

FRAMEWORK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBJECTUI_ROOT="${OBJECTUI_ROOT:-$(cd "${FRAMEWORK_ROOT}/../objectui" 2>/dev/null && pwd || true)}"
CLOUD_ROOT="${CLOUD_ROOT:-$(cd "${FRAMEWORK_ROOT}/../cloud" 2>/dev/null && pwd || true)}"

# Can `dir` see the whole of [since, ...)?  Prints the refusal block (markdown)
# on stdout and returns non-zero when it cannot; prints nothing and returns 0
# when it can.
cloud_window_guard() { # <dir> <since-iso>
  local dir="$1" since="$2" err rc=0
  err="$(mktemp)"
  if node "${FRAMEWORK_ROOT}/scripts/pm/git-history.mjs" ensure \
       --since="$since" --ref=HEAD --no-fetch --cwd="$dir" 2> "$err"; then
    rm -f "$err"
    return 0
  fi
  rc=1
  echo "> ⛔ **Cloud commit list WITHHELD — that checkout cannot see the whole window.**"
  echo ">"
  echo "> Printing it anyway would list only the commits above the shallow boundary, under the"
  echo "> same heading, with no sign that the rest exist — a short release-notes section reads"
  echo "> exactly like a quiet release (#9902)."
  echo
  echo '```'
  cat "$err"
  echo '```'
  rm -f "$err"
  return $rc
}

# Can `dir` walk the whole of `<prev>..<new>`?  Prints the refusal block
# (markdown) on stdout and returns non-zero when it cannot; prints nothing and
# returns 0 when it can.
#
# The range is asked about as an INSTANT, through the same predicate section 4
# uses, rather than with `merge-base --is-ancestor`: `PREV..NEW` is contained in
# [date(PREV), date(NEW)], so "is the floor below date(PREV)" answers this too —
# while `--is-ancestor` would also refuse PREV tagged off a side line, which is
# a legitimate release shape rather than a truncated clone.
changeset_range_guard() { # <dir> <prev-ref> <new-ref>
  local dir="$1" prev="$2" new="$3" err since rc=0
  since="$(git -C "$dir" log -1 --format=%cI "$prev")"
  err="$(mktemp)"
  if node "${FRAMEWORK_ROOT}/scripts/pm/git-history.mjs" ensure \
       --since="$since" --ref="$new" --no-fetch --cwd="$dir" 2> "$err"; then
    rm -f "$err"
    return 0
  fi
  rc=1
  echo "> ⛔ **Changeset list WITHHELD — this checkout cannot walk the whole ${prev}..${new} range.**"
  echo ">"
  echo "> Both endpoints resolve, so the walk exits 0 and prints a list — but any changeset"
  echo "> consumed below the shallow floor is missing from that list, and a short list under"
  echo "> this heading reads exactly like a release that shipped fewer items (#10509)."
  echo
  echo '```'
  cat "$err"
  echo '```'
  rm -f "$err"
  return $rc
}

# Print ONE consumed changeset's body, prefixed by the object it was read from.
# Returns non-zero — having printed a withheld block INSTEAD of a body — when
# the copy the release actually consumed is not in this checkout.
#
# There is deliberately no `|| git show <prev>:<path>` fallback here. That copy
# is the PRE-EDIT prose for any changeset revised during the dev cycle, and
# printed under this heading it is indistinguishable from the consumed one, so
# the release page quotes prose that was rewritten before it shipped. It is also
# not the safety net it reads as: a changeset consumed in this cycle usually did
# not exist at PREV_REF at all, so the fallback fails too and takes the whole
# script down mid-output under `set -e`.
changeset_body() { # <dir> <prev-ref> <new-ref> <path>
  local dir="$1" prev="$2" new="$3" f="$4" del body
  del="$(git -C "$dir" log --diff-filter=D --pretty=%H -1 "${prev}..${new}" -- "$f" || true)"
  # One `git show`, with its failure READ rather than discarded. This loop runs
  # once per consumed changeset — 2398 of them across an 11-day range on this
  # repo — so it stays at the two git processes per file the unguarded version
  # used; a separate `cat-file -e` probe would have added a third.
  if [[ -n "$del" ]] && body="$(git -C "$dir" show "${del}~1:${f}" 2>/dev/null)"; then
    echo "_source: \`${del:0:9}~1:${f}\` — the state this file had when the release consumed it._"
    echo
    echo '```md'
    printf '%s\n' "$body"
    echo '```'
    return 0
  fi
  echo "> ⛔ **Body WITHHELD — the copy this release consumed is not in this checkout.**"
  echo ">"
  echo "> No commit deleting this file is visible in \`${prev}..${new}\`, so the state it was in"
  echo "> when \`changeset version\` consumed it cannot be read here."
  echo ">"
  echo "> The \`${prev}\` copy is NOT a substitute — for a changeset edited during the cycle"
  echo "> that copy is the pre-edit prose. Read it deliberately if you want it anyway:"
  echo ">"
  echo ">     git show ${prev}:${f}"
  return 1
}

if [[ "${1:-}" == "--self-test" ]]; then
  fails=0
  ok() { if [[ "$2" == "1" ]]; then echo "  ✓ $1"; else echo "  ✗ $1${3:+
      $3}"; fails=$((fails + 1)); fi; }

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/up"
  (
    cd "$tmp/up"
    git init --quiet --initial-branch=main .
    git config user.email selftest@objectstack.ai
    git config user.name selftest
    for i in $(seq 0 39); do
      d="$(node -e "console.log(new Date(Date.parse('2026-06-01T12:00:00Z') + $i * 864e5).toISOString())")"
      printf 'commit %s\n' "$i" > f.txt
      # Two changesets, each EDITED mid-cycle before being consumed, so a
      # pre-edit copy is distinguishable from the consumed one by its text.
      # `.changeset/` is recreated every round: git drops the directory when the
      # last file in it is deleted, and a `>` into a missing directory fails
      # silently enough to leave a fixture that looks built and is not.
      mkdir -p .changeset
      case "$i" in
        2)  printf -- "---\n'@objectstack/core': patch\n---\n\nSPANS-PREV pre-edit prose.\n" > .changeset/spans-prev.md ;;
        10) printf -- "---\n'@objectstack/core': patch\n---\n\nSPANS-PREV post-edit prose.\n" > .changeset/spans-prev.md ;;
        18) git rm --quiet .changeset/spans-prev.md ;;
        20) printf -- "---\n'@objectstack/core': minor\n---\n\nLATE pre-edit prose.\n" > .changeset/late.md ;;
        24) printf -- "---\n'@objectstack/core': minor\n---\n\nLATE post-edit prose.\n" > .changeset/late.md ;;
        30) git rm --quiet .changeset/late.md ;;
      esac
      git add -A
      GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git commit --quiet -m "feat: change $i"
      if [[ "$i" == 5 ]];  then git tag prev; fi
      if [[ "$i" == 39 ]]; then git tag new;  fi
    done
  )
  git clone --quiet "file://$tmp/up" "$tmp/full"
  git clone --quiet --depth=5 "file://$tmp/up" "$tmp/shallow"
  # PREV_REF present, the range to it NOT walkable: a depth-12 clone, then the
  # old tag fetched in as its own shallow island. This is the shape a release
  # seat actually arrives at — `git fetch --shallow-since` and
  # `git fetch --depth=1 origin <tag>` both produce it — and it is the one where
  # `PREV..NEW` answers instead of failing.
  git clone --quiet --depth=12 "file://$tmp/up" "$tmp/island"
  git -C "$tmp/island" fetch --quiet --depth=1 origin 'refs/tags/prev:refs/tags/prev'

  WIN_SINCE=2026-06-20T00:00:00Z
  WIN_UNTIL=2026-07-11T00:00:00Z
  n_full=$(git -C "$tmp/full" log --no-merges --pretty='- %h %s' --since="$WIN_SINCE" --until="$WIN_UNTIL" | grep -c .)
  n_shallow=$(git -C "$tmp/shallow" log --no-merges --pretty='- %h %s' --since="$WIN_SINCE" --until="$WIN_UNTIL" | grep -c .)
  ok "BASELINE — the same window answers 21 in a full clone and $n_shallow in a shallow one, both exit 0 (the defect, reproduced)" \
     "$([[ "$n_full" == 21 && "$n_shallow" == 5 ]] && echo 1 || echo 0)" "full=$n_full shallow=$n_shallow"

  if out="$(cloud_window_guard "$tmp/full" "$WIN_SINCE")"; then g_full=1; else g_full=0; fi
  ok "a complete clone passes the guard and it prints nothing" "$([[ "$g_full" == 1 && -z "$out" ]] && echo 1 || echo 0)" "out=$out"

  if out="$(cloud_window_guard "$tmp/shallow" "$WIN_SINCE")"; then g_sh=1; else g_sh=0; fi
  ok "a shallow clone whose floor sits inside the window is REFUSED" "$([[ "$g_sh" == 0 ]] && echo 1 || echo 0)" "out=$out"
  ok "and the withheld block says so, names the floor, and carries the remedy" \
     "$(grep -q 'WITHHELD' <<< "$out" && grep -q 'shallow floor: 2026-07' <<< "$out" && grep -q 'unshallow' <<< "$out" && echo 1 || echo 0)" "$out"
  ok "and it prints no commit list at all — nothing in it can be transcribed as the section" \
     "$(grep -qE '^- [0-9a-f]+ feat' <<< "$out" && echo 0 || echo 1)" "$out"

  # The other leg: a still-shallow clone deep enough for the window must pass,
  # or the guard would refuse answers that are provably right and train bypass.
  if out="$(cloud_window_guard "$tmp/shallow" 2026-07-08T00:00:00Z)"; then g_narrow=1; else g_narrow=0; fi
  ok "a STILL-shallow clone whose floor predates the window passes untouched" "$([[ "$g_narrow" == 1 ]] && echo 1 || echo 0)" "out=$out"
  ok "and it is still shallow afterwards — the guard never deepens a checkout it does not own" \
     "$([[ "$(git -C "$tmp/shallow" rev-parse --is-shallow-repository)" == true ]] && echo 1 || echo 0)"

  # ── section 2: the changesets the release consumed (#10509) ───────────────
  consumed_of() { # <dir>
    git -C "$1" log --diff-filter=D --name-only --pretty=format: prev..new -- '.changeset/*.md' \
      | grep -v 'README' | grep . | sort -u || true
  }
  n_cs_full=$(consumed_of "$tmp/full" | grep -c . || true)
  n_cs_island=$(consumed_of "$tmp/island" | grep -c . || true)
  ok "BASELINE — prev..new lists 2 consumed changesets in a complete clone and $n_cs_island where PREV is a shallow island, both exit 0 (the defect, reproduced)" \
     "$([[ "$n_cs_full" == 2 && "$n_cs_island" == 1 ]] && echo 1 || echo 0)" "full=$n_cs_full island=$n_cs_island"

  if out="$(changeset_range_guard "$tmp/full" prev new)"; then g2_full=1; else g2_full=0; fi
  ok "a complete clone passes the range guard and it prints nothing" \
     "$([[ "$g2_full" == 1 && -z "$out" ]] && echo 1 || echo 0)" "out=$out"

  if out="$(changeset_range_guard "$tmp/island" prev new)"; then g2_isl=1; else g2_isl=0; fi
  ok "a clone whose PREV_REF RESOLVES but whose range is not walkable is REFUSED" \
     "$([[ "$g2_isl" == 0 ]] && echo 1 || echo 0)" "out=$out"
  ok "and that refusal says so, names the floor, and carries the remedy" \
     "$(grep -q 'WITHHELD' <<< "$out" && grep -q 'shallow floor: 2026-06-29' <<< "$out" && grep -q 'unshallow' <<< "$out" && echo 1 || echo 0)" "$out"
  ok "and it names no changeset at all — nothing in it can be transcribed as the section" \
     "$(grep -q '\.changeset/' <<< "$out" && echo 0 || echo 1)" "$out"

  body="$(changeset_body "$tmp/full" prev new .changeset/spans-prev.md)"
  ok "the body printed is the copy the release consumed, not the pre-edit one" \
     "$(grep -q 'SPANS-PREV post-edit prose' <<< "$body" && ! grep -q 'SPANS-PREV pre-edit prose' <<< "$body" && echo 1 || echo 0)" "$body"
  ok "and it names the object it was read from, so WHICH copy it is is answerable from the output" \
     "$(grep -qE '^_source: .[0-9a-f]{7,}~1:\.changeset/spans-prev\.md.' <<< "$body" && echo 1 || echo 0)" "$body"

  # The harm the filing card named, reproduced head-on. In the island clone the
  # consumed copy is unreachable and the PREV_REF copy is the PRE-EDIT prose:
  # the deleted `|| git show <prev>:<path>` fallback served exactly that, under
  # the normal heading, with nothing said. The refusal must not carry it.
  stale="$(git -C "$tmp/island" show "prev:.changeset/spans-prev.md")"
  ok "PRECONDITION — the PREV_REF copy the old fallback served is the PRE-EDIT prose" \
     "$(grep -q 'SPANS-PREV pre-edit prose' <<< "$stale" && echo 1 || echo 0)" "$stale"
  if body="$(changeset_body "$tmp/island" prev new .changeset/spans-prev.md)"; then b_isl=1; else b_isl=0; fi
  ok "a body whose consuming commit is below the floor is WITHHELD, not served from PREV_REF" \
     "$([[ "$b_isl" == 0 ]] && echo 1 || echo 0)" "$body"
  # `SPANS-PREV` is uppercase in the fixture PROSE and lowercase in the PATH, so
  # this matches leaked body text without matching the remedy line that quotes
  # the path — and without matching the words "pre-edit prose" in the warning.
  ok "and that refusal carries no fenced body a release page could be written from" \
     "$(grep -q 'SPANS-PREV' <<< "$body" && echo 0 || echo 1)" "$body"

  # Wiring: the guard is worthless if section 4 stops calling it.
  #
  # The needle is ASSEMBLED from two adjacent literals rather than written out,
  # and that is load-bearing. Written out, the pattern occurs in this very
  # assertion, so the grep matches its own source line and the case passes with
  # section 4 unwired — measured exactly that way while ablating this guard:
  # the call was deleted, the script still parsed, and the pin printed a tick.
  # A pin that cannot fail is worse than no pin, because it is believed.
  needle="elif ! cloud_window""_guard \"\$CLOUD_ROOT\""
  ok "section 4 routes its windowed question through the guard" \
     "$(grep -qF "$needle" "${BASH_SOURCE[0]}" && echo 1 || echo 0)" "needle: $needle"

  needle2="if ! changeset_range""_guard \"\$FRAMEWORK_ROOT\""
  ok "section 2 routes its range question through the guard" \
     "$(grep -qF "$needle2" "${BASH_SOURCE[0]}" && echo 1 || echo 0)" "needle: $needle2"

  needle3="if ! changeset""_body \"\$FRAMEWORK_ROOT\""
  ok "section 2 prints every body through the reader that labels it" \
     "$(grep -qF "$needle3" "${BASH_SOURCE[0]}" && echo 1 || echo 0)" "needle: $needle3"

  # Inverted pin, so it too is assembled: written out, it would match its own
  # source line and report the fallback still present on a clean file.
  needle4="|| git show \"\${PREV""_REF}"
  ok "and the unlabelled PREV_REF fallback is GONE from the file, not merely bypassed" \
     "$(grep -qF "$needle4" "${BASH_SOURCE[0]}" && echo 0 || echo 1)" "needle: $needle4"

  echo
  if [[ "$fails" == 0 ]]; then echo "collect-release-notes --self-test: all cases passed."; else echo "collect-release-notes --self-test: $fails FAILED."; exit 1; fi
  exit 0
fi

PREV_REF="${1:?usage: collect-release-notes.sh <prev-ref> [<new-ref>]}"
NEW_REF="${2:-HEAD}"
withheld_names=""

# Record a section (or a single changeset) as withheld, for the INCOMPLETE
# trailer and the non-zero exit. Both are needed: the trailer is for the human
# reading the markdown, the exit code for `... > material.md` in a pipeline.
mark_withheld() { # <name>
  withheld_names="${withheld_names:+${withheld_names}; }$1"
}

cd "$FRAMEWORK_ROOT"

# Print a commit list with feat/fix first, the rest after — `chore!:` and
# similar breakage hides in the second bucket, so it stays visible.
print_log_split() { # <git-dir> <range-or-window...>
  local dir="$1"; shift
  local all
  all=$(git -C "$dir" log --no-merges --pretty='- %h %s' "$@")
  echo "### feat / fix"
  echo
  grep -E '^- [0-9a-f]+ (feat|fix)' <<< "$all" || echo "_none_"
  echo
  echo "### everything else (watch for chore!: / refactor!: breakage)"
  echo
  grep -Ev '^- [0-9a-f]+ (feat|fix)' <<< "$all" || echo "_none_"
}

echo "# Release material: ${PREV_REF} → ${NEW_REF}"
echo

echo "## 1. Framework — all commits in the range"
echo
print_log_split "$FRAMEWORK_ROOT" "${PREV_REF}".."${NEW_REF}"
echo

echo "## 2. Framework — changesets consumed in this release"
echo

# WHICH changesets were consumed is a range question, and both endpoints
# resolving does not make the range walkable — so ask the horizon before
# answering. An unguarded short list here is a release page missing however
# many items were consumed below the graft, with nothing to say so.
if ! changeset_range_guard "$FRAMEWORK_ROOT" "$PREV_REF" "$NEW_REF"; then
  mark_withheld "section 2 (the changeset list)"
else
  # Changesets deleted anywhere in the range were consumed by `changeset
  # version` for this release. (An endpoint diff would miss files added and
  # consumed within the same dev cycle, so walk the log instead.)
  consumed=$(git log --diff-filter=D --name-only --pretty=format: "${PREV_REF}".."${NEW_REF}" -- '.changeset/*.md' \
    | grep -v 'README' | grep . | sort -u || true)

  if [[ -z "$consumed" ]]; then
    echo "_None found — is ${NEW_REF} past the 'chore: version packages' commit?_"
  else
    while IFS= read -r f; do
      echo "### ${f}"
      echo
      # Prints the body AND the object it came from, or withholds it. The file
      # may have been added after PREV_REF, so the copy wanted is its last
      # pre-deletion state — never the PREV_REF one, which is the pre-edit
      # prose whenever the changeset was revised during the cycle.
      if ! changeset_body "$FRAMEWORK_ROOT" "$PREV_REF" "$NEW_REF" "$f"; then
        mark_withheld "section 2 (the body of ${f})"
      fi
      echo
    done <<< "$consumed"
  fi
fi

echo "## 3. Console UI (objectui) — pin range"
echo

prev_sha=$(git show "${PREV_REF}:.objectui-sha" 2>/dev/null || true)
new_sha=$(git show "${NEW_REF}:.objectui-sha" 2>/dev/null || cat .objectui-sha)

echo "- previous pin: \`${prev_sha:-<none>}\`"
echo "- this release: \`${new_sha}\`"
echo

if [[ -z "$prev_sha" ]]; then
  echo "_No .objectui-sha at ${PREV_REF}; cannot compute the range._"
elif [[ "$prev_sha" == "$new_sha" ]]; then
  echo "_Console pin unchanged — no objectui delta in this release._"
elif [[ -z "$OBJECTUI_ROOT" || ! -d "$OBJECTUI_ROOT/.git" ]]; then
  echo "_objectui checkout not found (set OBJECTUI_ROOT); range is ${prev_sha}..${new_sha}_"
else
  print_log_split "$OBJECTUI_ROOT" "${prev_sha}..${new_sha}"
fi
echo

echo "## 4. Cloud (control plane) — time window"
echo

prev_date=$(git log -1 --format=%cI "${PREV_REF}")
new_date=$(git log -1 --format=%cI "${NEW_REF}")
echo "- window: ${prev_date} → ${new_date} (cloud is not pinned; window edges are approximate)"
echo

if [[ -z "$CLOUD_ROOT" || ! -d "$CLOUD_ROOT/.git" ]]; then
  echo "_cloud checkout not found (set CLOUD_ROOT); scan it by this window manually._"
elif ! cloud_window_guard "$CLOUD_ROOT" "$prev_date"; then
  mark_withheld "section 4 (the cloud commit list)"
else
  print_log_split "$CLOUD_ROOT" --since="$prev_date" --until="$new_date"
fi

echo
echo "---"
if [[ -n "$withheld_names" ]]; then
  echo "_⛔ INCOMPLETE — WITHHELD: ${withheld_names}. See the block(s) above. This material is"
  echo "not a complete basis for a release page until those checkouts are deepened._"
  echo
fi
echo "_Write the curated page at content/docs/releases/, register it in"
echo "content/docs/releases/meta.json, and link it from index.mdx. Items with a"
echo "changeset have the best prose in section 2; section 1 is the completeness"
echo "check — every developer-visible feat/fix should be accounted for._"

# A withheld section must be legible to a pipeline too, not only to the reader:
# `... > material.md` succeeding is otherwise the only signal, and it lies.
if [[ -n "$withheld_names" ]]; then
  echo "collect-release-notes: INCOMPLETE — withheld: ${withheld_names} (see the output)." >&2
  exit 2
fi
