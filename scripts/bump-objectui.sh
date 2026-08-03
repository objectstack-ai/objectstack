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
#   CONSOLE_BUMP=major|minor|patch  # force the changeset bump type (default: auto —
#                             # the HIGHEST level objectui itself declared in the
#                             # changesets added over the range; see #4731)
#   CONSOLE_CHANGES_MAX=<n>   # cap the rendered list (default 100). A cap that
#                             # fires says so, with the real count — never silently.
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
      sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
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
  RANGE_OK=0
  if [[ "$OLD_SHA" != "<none>" ]] && git -C "$OBJECTUI_ROOT" cat-file -e "${OLD_SHA}^{commit}" 2>/dev/null; then
    RANGE_OK=1
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
