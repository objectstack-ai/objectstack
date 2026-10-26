#!/usr/bin/env bash
# The build of @objectstack/console: a copy of this workspace's own
# @object-ui/console build. Nothing is cloned and nothing is pinned — the
# Console source lives in ui/apps/console, its @objectstack/* dependencies are
# `workspace:^`, and the root turbo.json makes `@objectstack/console#build`
# depend on `@object-ui/console#build`, so the dist copied here was built
# against this tree's spec and client by construction. Run it through turbo
# (`pnpm console:build`, or the root `pnpm build`), never directly: a direct
# run copies whatever ui/apps/console/dist holds, however old.
#
# What it ships: ui/apps/console/dist as-is, with the TRACKED repo-root
# sdui.manifest.json copied over `dist/sdui.manifest.json` (ADR-0080; the CLI's
# JSX gate reads it there, see packages/cli/src/utils/sdui-manifest.ts). The
# manifest copy is the one file in this package's dist that comes from outside
# the Console build, and `scripts/check-changeset-no-major.mjs` reads it out of
# this script (PACKED_COPY_BUILD_SCRIPTS) to grade what a manifest change ships.
#
# Usage:
#   bash packages/console/build-dist.sh
#   bash packages/console/build-dist.sh --check-single-zod <assets-dir>
#                           run ONLY the single-zod canary (below) over an
#                           existing dist's assets/ and exit with its verdict;
#                           copies nothing, writes nothing

set -euo pipefail

# ── Single-zod canary (objectstack#21108) ────────────────────────────
# The console bundle must carry exactly ONE zod instance. Two copies split
# zod's internals: a spec schema built by one instance and walked by the other
# (`z.toJSONSchema`) throws, so every spec-derived Studio form lost its fields —
# the New Package dialog could not create a package and the dashboard/report
# inspectors read "Spec schema unavailable".
#
# The console's own Vite build pins every `zod` import to one copy and fails on
# more than one zod package directory in the emitted chunks (objectui#11353).
# This is the belt to that brace, measured on what this package SHIPS rather
# than on how the console build is configured, so it still holds for a build
# that drops or weakens that guard — one workspace lockfile can still resolve
# two zod versions.
#
# What it counts: zod 4 stamps every instance with a version object literal
# (`version` in `zod/v4/core/versions`, read back as `_zod.version`), which the
# minifier emits as `{major:4,minor:6,patch:5}`. One instance = one literal, so
# the canary requires EXACTLY ONE occurrence across assets/*.js:
#   - two DIFFERENT literals: two zod versions, the shipped defect;
#   - one literal found twice: two instances of the same version — still two
#     instances, which is what the crash keys on;
#   - none at all: the matcher has gone blind (the console always bundles zod),
#     and a negative check that cannot see its subject would pass forever.
ZOD_VERSION_LITERAL='\{[[:space:]]*major:[[:space:]]*[0-9]+,[[:space:]]*minor:[[:space:]]*[0-9]+,[[:space:]]*patch:[[:space:]]*[0-9]+[[:space:]]*,?[[:space:]]*\}'

assert_single_zod() {
  local assets="$1"
  if [[ ! -d "$assets" ]]; then
    echo "✗ Single-zod canary: ${assets} is not a directory."
    return 1
  fi
  local files=()
  local f
  for f in "$assets"/*.js; do
    [[ -f "$f" ]] && files+=("$f")
  done
  if (( ${#files[@]} == 0 )); then
    echo "✗ Single-zod canary: no .js files under ${assets} — nothing was measured."
    return 1
  fi
  local hits="" rc=0
  hits="$(grep -oHE "$ZOD_VERSION_LITERAL" "${files[@]}")" || rc=$?
  if (( rc > 1 )); then
    echo "✗ Single-zod canary: grep failed (exit ${rc}) reading ${assets}/*.js."
    return 1
  fi
  # One line per occurrence: <file>:<literal>, the literal's whitespace and any
  # trailing comma dropped so a re-formatted bundle reads the same version.
  local occurrences
  occurrences="$(printf '%s\n' "$hits" | sed -e '/^$/d' -e 's/[[:space:]]//g' -e 's/,}$/}/')"
  local count=0 distinct=0
  if [[ -n "$occurrences" ]]; then
    count="$(printf '%s\n' "$occurrences" | wc -l | tr -d ' ')"
    distinct="$(printf '%s\n' "$occurrences" | sed 's/^.*:{/{/' | sort -u | wc -l | tr -d ' ')"
  fi
  if (( count == 0 )); then
    echo "✗ Single-zod canary: none of the ${#files[@]} assets/*.js files carries a zod version"
    echo "  literal ({major:N,minor:N,patch:N}). The console always bundles zod, so zero means"
    echo "  this matcher can no longer see it — and a check that cannot see its subject cannot"
    echo "  fail. Fix the matcher (ZOD_VERSION_LITERAL in packages/console/build-dist.sh) before"
    echo "  trusting this bundle."
    return 1
  fi
  if (( count > 1 )); then
    if (( distinct > 1 )); then
      echo "✗ Single-zod canary: the console bundle carries ${distinct} different zod versions"
      echo "  (${count} version literals) and must carry exactly one:"
    else
      echo "✗ Single-zod canary: the console bundle carries ${count} copies of ONE zod version"
      echo "  literal — two instances of the same version are still two instances:"
    fi
    printf '%s\n' "$occurrences" | sed "s|^${assets%/}/|    |"
    echo "  A schema built by one zod instance and walked by another breaks every spec-derived"
    echo "  Studio form. The workspace lockfile resolves zod twice for the console's closure:"
    echo "  dedupe it (one zod line across packages/spec and ui/apps/console), then rebuild."
    return 1
  fi
  echo "✓ Single-zod canary: exactly one zod version literal $(printf '%s' "$occurrences" | sed 's/^.*:{/{/') in ${occurrences%%:*}."
  echo "  (${#files[@]} assets/*.js files read)"
  return 0
}

if [[ "${1:-}" == "--check-single-zod" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "usage: packages/console/build-dist.sh --check-single-zod <assets-dir>"
    exit 2
  fi
  if assert_single_zod "$2"; then exit 0; fi
  exit 1
fi

FRAMEWORK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONSOLE_DIST="${FRAMEWORK_ROOT}/ui/apps/console/dist"
TARGET="${FRAMEWORK_ROOT}/packages/console/dist"
MANIFEST_SRC="${FRAMEWORK_ROOT}/sdui.manifest.json"

if [[ ! -f "${CONSOLE_DIST}/index.html" ]]; then
  echo "✗ ${CONSOLE_DIST}/index.html is missing — @object-ui/console has not been built."
  echo "  Build through turbo, which builds it first: pnpm console:build"
  exit 1
fi
if [[ ! -f "$MANIFEST_SRC" ]]; then
  echo "✗ ${MANIFEST_SRC} is missing — the console dist ships the tracked SDUI manifest."
  echo "  Regenerate it: node scripts/gen-sdui-manifest-node.mjs"
  exit 1
fi

echo "→ Copying ${CONSOLE_DIST} → ${TARGET}"
rm -rf "$TARGET"
cp -R "$CONSOLE_DIST" "$TARGET"
cp "$MANIFEST_SRC" "${TARGET}/sdui.manifest.json"

# Placed after the copy so it judges the bytes this package publishes.
if ! assert_single_zod "${TARGET}/assets"; then
  rm -rf "$TARGET"
  exit 1
fi

BYTES="$(du -sk "$TARGET" 2>/dev/null | awk '{print $1}')"
echo "✓ @objectstack/console dist ready (${BYTES} KB) from ui/apps/console, with the tracked sdui.manifest.json"
