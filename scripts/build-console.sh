#!/usr/bin/env bash
# Build @object-ui/console at the SHA pinned in .objectui-sha and copy
# its dist/ into packages/console/ so @objectstack/console can publish
# a version-matched, prebuilt Console SPA alongside the framework.
#
# Resolution order for the objectui source tree:
#   1. $OBJECTUI_ROOT (if set and a git repo)         — explicit override
#   2. ../objectui sibling checkout                   — local dev layout
#   3. Shallow clone into .cache/objectui at the SHA  — CI / fresh machines
#
# In modes 1 and 2 the script does NOT mutate the developer's checkout —
# it creates a git worktree at the pinned SHA so the dev tree is left alone.
# Mode 3 fetches just the pinned commit.
#
# Always rebuilds the dist (no `if exists, skip` shortcut) so a stale
# tree can't mask a bad SHA in CI.
#
# Usage:
#   scripts/build-console.sh
#
# Env:
#   OBJECTUI_ROOT          override path to objectui checkout
#   OBJECTUI_REPO_URL      override clone URL (default: https://github.com/objectstack-ai/objectui.git)
#   OBJECTUI_BUILD_CMD     override build command (default: pnpm exec turbo run build --filter=@object-ui/console)

set -euo pipefail

FRAMEWORK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHA_FILE="${FRAMEWORK_ROOT}/.objectui-sha"

if [[ ! -f "$SHA_FILE" ]]; then
  echo "✗ ${SHA_FILE} is missing — cannot determine which objectui commit to build."
  exit 1
fi

PINNED_SHA="$(tr -d '[:space:]' < "$SHA_FILE")"
if [[ -z "$PINNED_SHA" ]]; then
  echo "✗ ${SHA_FILE} is empty."
  exit 1
fi

REPO_URL="${OBJECTUI_REPO_URL:-https://github.com/objectstack-ai/objectui.git}"
BUILD_CMD="${OBJECTUI_BUILD_CMD:-pnpm exec turbo run build --filter=@object-ui/console}"

# Resolve a source checkout of objectui.
SOURCE_ROOT=""
if [[ -n "${OBJECTUI_ROOT:-}" && -d "${OBJECTUI_ROOT}/.git" ]]; then
  SOURCE_ROOT="$OBJECTUI_ROOT"
elif [[ -d "${FRAMEWORK_ROOT}/../objectui/.git" ]]; then
  SOURCE_ROOT="$(cd "${FRAMEWORK_ROOT}/../objectui" && pwd)"
fi

# Worktree path we'll build from. Always under framework so cleanup is local.
BUILD_ROOT="${FRAMEWORK_ROOT}/.cache/objectui-${PINNED_SHA:0:12}"
mkdir -p "${FRAMEWORK_ROOT}/.cache"

if [[ -n "$SOURCE_ROOT" ]]; then
  echo "→ Using objectui source at ${SOURCE_ROOT}"
  # Fetch the pinned commit if missing locally, so dev laptops with a
  # stale checkout still work.
  if ! git -C "$SOURCE_ROOT" cat-file -e "${PINNED_SHA}^{commit}" 2>/dev/null; then
    echo "→ Pinned commit ${PINNED_SHA:0:12} not present locally — fetching from origin..."
    git -C "$SOURCE_ROOT" fetch --no-tags origin "$PINNED_SHA" || \
      git -C "$SOURCE_ROOT" fetch --no-tags origin
  fi

  # Reuse worktree if it already points at the right commit; otherwise
  # remove and recreate so we always build the pinned tree.
  if [[ -d "$BUILD_ROOT" ]]; then
    CURRENT="$(git -C "$BUILD_ROOT" rev-parse HEAD 2>/dev/null || echo '')"
    if [[ "$CURRENT" != "$PINNED_SHA" ]]; then
      git -C "$SOURCE_ROOT" worktree remove --force "$BUILD_ROOT" 2>/dev/null || rm -rf "$BUILD_ROOT"
    fi
  fi
  if [[ ! -d "$BUILD_ROOT" ]]; then
    git -C "$SOURCE_ROOT" worktree add --detach "$BUILD_ROOT" "$PINNED_SHA"
  fi
else
  echo "→ No local objectui checkout — shallow-cloning ${REPO_URL} at ${PINNED_SHA:0:12}"
  if [[ -d "$BUILD_ROOT/.git" ]]; then
    CURRENT="$(git -C "$BUILD_ROOT" rev-parse HEAD 2>/dev/null || echo '')"
    if [[ "$CURRENT" != "$PINNED_SHA" ]]; then
      rm -rf "$BUILD_ROOT"
    fi
  fi
  if [[ ! -d "$BUILD_ROOT/.git" ]]; then
    rm -rf "$BUILD_ROOT"
    mkdir -p "$BUILD_ROOT"
    git -C "$BUILD_ROOT" init -q
    git -C "$BUILD_ROOT" remote add origin "$REPO_URL"
    git -C "$BUILD_ROOT" fetch --depth=1 origin "$PINNED_SHA"
    git -C "$BUILD_ROOT" checkout --detach FETCH_HEAD
  fi
fi

# Verify HEAD matches the pin.
ACTUAL="$(git -C "$BUILD_ROOT" rev-parse HEAD)"
if [[ "$ACTUAL" != "$PINNED_SHA" ]]; then
  echo "✗ Worktree HEAD ${ACTUAL:0:12} does not match pin ${PINNED_SHA:0:12}"
  exit 1
fi

echo "→ Building @object-ui/console at ${PINNED_SHA:0:12}..."
pushd "$BUILD_ROOT" > /dev/null

# objectui's root package.json may pin packages that aren't available on
# every mirror. Fall back to the public registry just for this install.
NPM_CONFIG_REGISTRY_OVERRIDE="${OBJECTUI_NPM_REGISTRY:-https://registry.npmjs.org}"
npm_config_registry="$NPM_CONFIG_REGISTRY_OVERRIDE" \
  pnpm install --frozen-lockfile --prefer-offline --prod=false

# Build only the console SPA (turbo will pull in workspace deps).
eval "$BUILD_CMD"

popd > /dev/null

CONSOLE_DIST="${BUILD_ROOT}/apps/console/dist"
if [[ ! -f "${CONSOLE_DIST}/index.html" ]]; then
  echo "✗ Build did not produce ${CONSOLE_DIST}/index.html"
  exit 1
fi

TARGET="${FRAMEWORK_ROOT}/packages/console/dist"
echo "→ Copying dist → ${TARGET}"
rm -rf "$TARGET"
mkdir -p "$(dirname "$TARGET")"
cp -R "$CONSOLE_DIST" "$TARGET"

# Provenance stamp: record which objectui SHA this dist was built from, so
# `pnpm check:console-sha` and the CLI serve-time guard can detect drift when
# .objectui-sha later moves ahead of this gitignored, locally-built dist
# (which `turbo run build` does NOT rebuild). Travels inside dist/ so a
# cloud/objectos Docker overlay that replaces dist/ restamps it too.
echo "$PINNED_SHA" > "${TARGET}/.objectui-sha"

BYTES="$(du -sk "$TARGET" 2>/dev/null | awk '{print $1}')"
echo "✓ @objectstack/console dist ready (${BYTES} KB) from objectui@${PINNED_SHA:0:12}"

# ADR-0080/0081: the public-tier SDUI manifest and the spec↔frontend react-block
# conformance ratchet are intentionally NOT generated here — they require a real
# browser (Playwright) to enumerate the console registry, and the console build
# must not drag in a browser dependency. Regenerate them on demand instead:
#   pnpm sdui:manifest        (see scripts/gen-sdui-manifest.sh)
echo "ℹ SDUI manifest + conformance ratchet are decoupled from the console build."
echo "  Run 'pnpm sdui:manifest' on demand to regenerate (requires Playwright)."
