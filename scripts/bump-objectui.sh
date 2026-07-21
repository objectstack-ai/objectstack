#!/usr/bin/env bash
# Bump the objectui SHA the framework workspace pins against.
#
# Usage:
#   scripts/bump-objectui.sh                # bump to current HEAD of ../objectui
#   scripts/bump-objectui.sh <sha>          # bump to an explicit SHA (or ref)
#   scripts/bump-objectui.sh --no-commit    # update files only, don't commit
#   scripts/bump-objectui.sh --no-changeset # skip the @objectstack/console changeset
#
# Env:
#   CONSOLE_BUMP=minor|patch  # force the changeset bump type (default: auto —
#                             # `minor` if the objectui range has any feat, else patch)
#
# Assumes sibling layout:
#   ~/work/objectui
#   ~/work/objectstack   ← run from here
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
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) EXPLICIT_SHA="$arg" ;;
  esac
done

if [[ -z "${OBJECTUI_ROOT}" || ! -d "${OBJECTUI_ROOT}/.git" ]]; then
  echo "✗ Cannot find objectui checkout at ${FRAMEWORK_ROOT}/../objectui"
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
  # a first-ever pin may not have OLD reachable — degrade to the tip subject.)
  RANGE_OK=0
  if [[ "$OLD_SHA" != "<none>" ]] && git -C "$OBJECTUI_ROOT" cat-file -e "${OLD_SHA}^{commit}" 2>/dev/null; then
    RANGE_OK=1
  fi

  CHANGES=""
  if [[ "$RANGE_OK" -eq 1 ]]; then
    CHANGES="$(git -C "$OBJECTUI_ROOT" log --no-merges --format='- %s' "${OLD_SHA}..${NEW_SHA}" \
      | grep -iE '^- (feat|fix)' | head -40 || true)"
  fi
  [[ -z "$CHANGES" ]] && CHANGES="- ${SUBJECT_LINE}"

  BUMP="${CONSOLE_BUMP:-}"
  if [[ -z "$BUMP" ]]; then
    if [[ "$RANGE_OK" -eq 1 ]] && \
       git -C "$OBJECTUI_ROOT" log --format=%s "${OLD_SHA}..${NEW_SHA}" | grep -qiE '^feat'; then
      BUMP=minor
    else
      BUMP=patch
    fi
  fi

  RANGE_LABEL="${OLD_SHA:0:12}...${NEW_SHA:0:12}"
  [[ "$OLD_SHA" == "<none>" ]] && RANGE_LABEL="(initial pin) → ${NEW_SHA:0:12}"

  CS_FILE="${FRAMEWORK_ROOT}/.changeset/console-${SHORT}.md"
  cat > "$CS_FILE" <<EOF
---
"@objectstack/console": ${BUMP}
---

Console (objectui) refreshed to \`${SHORT}\`. Frontend changes in this range:

${CHANGES}

objectui range: \`${RANGE_LABEL}\`
EOF
  echo "→ wrote changeset $(basename "$CS_FILE") (@objectstack/console: ${BUMP})"
fi

if [[ "$NO_COMMIT" -eq 1 ]]; then
  echo "→ --no-commit: leaving files unstaged."
  exit 0
fi

git -C "$FRAMEWORK_ROOT" add .objectui-sha
[[ -n "$CS_FILE" ]] && git -C "$FRAMEWORK_ROOT" add "$CS_FILE"
git -C "$FRAMEWORK_ROOT" commit -m "chore: bump objectui to ${SHORT}

${SUBJECT_LINE}

objectui@${NEW_SHA}" -- .objectui-sha ${CS_FILE:+"$CS_FILE"}
echo "✓ Committed. Push with: git push"
