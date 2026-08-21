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
# ## Section 4 asks a WINDOWED history question, so it is horizon-guarded (#9902)
#
# Sections 1-3 ask range questions (`<ref>..<ref>`): a missing endpoint is a
# `fatal: bad object` and `set -e` stops the script. Section 4 cannot fail that
# way — `git log --since/--until` over a shallow checkout answers from whatever
# part of the window is present, exits 0, and prints no warning. This script
# has no CI caller at all; it runs at release time from a seat, and it reads a
# cloud checkout it does not own.
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
      git add f.txt
      GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git commit --quiet -m "feat: change $i"
    done
  )
  git clone --quiet "file://$tmp/up" "$tmp/full"
  git clone --quiet --depth=5 "file://$tmp/up" "$tmp/shallow"

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

  # Wiring: the guard is worthless if section 4 stops calling it.
  ok "section 4 routes its windowed question through the guard" \
     "$(grep -q 'cloud_window_guard "$CLOUD_ROOT" "$prev_date"' "${BASH_SOURCE[0]}" && echo 1 || echo 0)"

  echo
  if [[ "$fails" == 0 ]]; then echo "collect-release-notes --self-test: all cases passed."; else echo "collect-release-notes --self-test: $fails FAILED."; exit 1; fi
  exit 0
fi

PREV_REF="${1:?usage: collect-release-notes.sh <prev-ref> [<new-ref>]}"
NEW_REF="${2:-HEAD}"
withheld=0

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
    echo '```md'
    # The file may have been added after PREV_REF; show its last pre-deletion state.
    git show "$(git log --diff-filter=D --pretty=%H -1 "${NEW_REF}" -- "$f")~1:$f" 2>/dev/null \
      || git show "${PREV_REF}:${f}"
    echo '```'
    echo
  done <<< "$consumed"
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
  withheld=1
else
  print_log_split "$CLOUD_ROOT" --since="$prev_date" --until="$new_date"
fi

echo
echo "---"
if [[ "$withheld" == 1 ]]; then
  echo "_⛔ INCOMPLETE: section 4 was withheld — see the block above. This material is not a"
  echo "complete basis for a release page until that checkout is deepened._"
  echo
fi
echo "_Write the curated page at content/docs/releases/, register it in"
echo "content/docs/releases/meta.json, and link it from index.mdx. Items with a"
echo "changeset have the best prose in section 2; section 1 is the completeness"
echo "check — every developer-visible feat/fix should be accounted for._"

# A withheld section must be legible to a pipeline too, not only to the reader:
# `... > material.md` succeeding is otherwise the only signal, and it lies.
if [[ "$withheld" == 1 ]]; then
  echo "collect-release-notes: INCOMPLETE — the cloud section was withheld (see the output)." >&2
  exit 2
fi
