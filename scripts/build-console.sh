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
#   OBJECTUI_ROOT           override path to objectui checkout
#   OBJECTUI_REPO_URL       override clone URL (default: https://github.com/objectstack-ai/objectui.git)
#   OBJECTUI_DEPS_BUILD_CMD override deps build (default: pnpm exec turbo run build --filter=@object-ui/console^...)
#   OBJECTUI_BUILD_CMD      override console build (default: pnpm --filter @object-ui/console run build)
#   CONSOLE_BUNDLE_CANARY   literal asserted in the built assets (default: import/jobs)

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
# The console app itself must NOT build through turbo: turbo v2 runs tasks in
# strict env mode and strips undeclared vars, so OBJECTSTACK_CLIENT_DIST and
# OBJECTSTACK_SPEC_DIST (both exported below) never reach vite unless the pinned
# objectui SHA happens to declare them in turbo.json. Build the workspace deps
# through turbo (cacheable, env-independent), then invoke the console's own build
# script directly so the env survives.
DEPS_BUILD_CMD="${OBJECTUI_DEPS_BUILD_CMD:-pnpm exec turbo run build --filter=@object-ui/console^...}"
BUILD_CMD="${OBJECTUI_BUILD_CMD:-pnpm --filter @object-ui/console run build}"
# Post-build canary: a literal that only exists in an up-to-date bundled
# client. Guards against any future mechanism (turbo env stripping, a removed
# vite hook, chunking changes) silently shipping a stale client again.
BUNDLE_CANARY="${CONSOLE_BUNDLE_CANARY:-import/jobs}"

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

# ── Bundle THIS framework's client ───────────────────────────────────
# The console SPA inlines @objectstack/client. Left to itself, the objectui
# build resolves the client from objectui's own lockfile — which lags the
# framework whenever a release adds new client APIs (the lockfile can't point
# at a client that isn't published yet). That shipped 11.5.0 with the new
# import UI bundled against client 11.2.0, so the console threw "does not
# support async import jobs" at runtime. Alias the build to the client in
# THIS tree instead: the bundled client then always matches the framework
# release being published, with no objectui pin-bump round-trip.
# objectui honors OBJECTSTACK_CLIENT_DIST in apps/console/vite.config.ts;
# fail hard if the pinned SHA predates that hook rather than silently drift.
CLIENT_PKG="${FRAMEWORK_ROOT}/packages/client"
if ! grep -q "OBJECTSTACK_CLIENT_DIST" "${BUILD_ROOT}/apps/console/vite.config.ts"; then
  echo "✗ objectui@${PINNED_SHA:0:12} has no OBJECTSTACK_CLIENT_DIST hook in apps/console/vite.config.ts —"
  echo "  the bundled client would come from objectui's lockfile, not this framework."
  echo "  Bump .objectui-sha to a commit that includes the hook."
  exit 1
fi
# Build the client THROUGH TURBO, not by shelling into the package. turbo.json
# declares "build": { "dependsOn": ["^build"] }, and `cd packages/client && pnpm
# build` bypasses exactly that guarantee. On a cold tree packages/spec/dist and
# packages/core/dist do not exist yet, so the client's subpath imports
# (@objectstack/spec/data, @objectstack/core/logger, ...) resolve to nothing and
# the tsup DTS pass dies. `--filter=@objectstack/client` alone is enough — the
# dependency closure comes from ^build, not from a `...` filter suffix (measured:
# 32 build tasks in scope).
#
# Guard on the DECLARATION, not on dist/index.mjs: tsup writes the CJS/ESM
# bundles BEFORE the DTS pass, so a client build that died in DTS still leaves
# dist/index.mjs on disk. Keying the guard on it made a half-built client look
# complete, so the next run skipped the build and carried on with a client dist
# whose declarations were never generated. dist/index.d.ts is this package's
# declared type entrypoint (package.json "types" and exports["."].types) and
# only appears once the DTS pass has succeeded.
#
# Under OS_SKIP_DTS (see tsup.config.ts) there is legitimately no declaration,
# so this guard re-fires on every run — harmless, because the turbo build it
# guards is cached.
CLIENT_DTS="${CLIENT_PKG}/dist/index.d.ts"
if [[ ! -f "$CLIENT_DTS" ]]; then
  echo "→ @objectstack/client dist absent or incomplete (no dist/index.d.ts) — building it and its deps first..."
  (cd "$FRAMEWORK_ROOT" && pnpm exec turbo run build --filter=@objectstack/client)
fi
export OBJECTSTACK_CLIENT_DIST="$CLIENT_PKG"
echo "→ Console will bundle @objectstack/client from ${CLIENT_PKG}"

# ── Bundle THIS framework's spec ─────────────────────────────────────
# The same class of skew as the client above, one level quieter. The console SPA
# inlines @objectstack/spec, and left to itself the objectui build resolves it
# from objectui's own lockfile under --frozen-lockfile — the last PUBLISHED spec,
# never this workspace. So an authorable key added to packages/spec after that
# publish is accepted and round-tripped by the server while the Studio designer
# rejects it as an unrecognized key and refuses to auto-save, and the
# framework-side card closes green because packages/spec's own pins all pass.
# Reaching the key took three ordered cross-repo steps: spec publishes, objectui
# refreshes its lockfile, this pin moves. Injecting this tree's spec collapses
# all three (objectstack#8134, hook added in objectui#4854).
#
# objectui honors OBJECTSTACK_SPEC_DIST in apps/console/vite.config.ts; fail hard
# if the pinned SHA predates that hook rather than silently drift — an unguarded
# injection would quietly rebuild the exact silent skew it exists to end.
SPEC_PKG="${FRAMEWORK_ROOT}/packages/spec"
if ! grep -q "OBJECTSTACK_SPEC_DIST" "${BUILD_ROOT}/apps/console/vite.config.ts"; then
  echo "✗ objectui@${PINNED_SHA:0:12} has no OBJECTSTACK_SPEC_DIST hook in apps/console/vite.config.ts —"
  echo "  the bundled spec would come from objectui's lockfile, not this framework, so"
  echo "  any key this tree declares since the last spec publish would be unreachable"
  echo "  in the Studio designer."
  echo "  Bump .objectui-sha to a commit that includes the hook."
  exit 1
fi
# The hook resolves EVERY entry of the spec's exports map and refuses any whose
# target is missing, so the package must be built before it is injected. Two
# sentinels, because two different generators produce those targets:
# dist/index.mjs is tsup's, and json-schema/openapi.json is `gen:openapi`'s — the
# one export entry that does not live under dist/, is not committed, and is wiped
# by a later `gen:schema` run. A guard keyed on dist/ alone sails past a tree
# where that happened, and the hook then throws in the middle of the console build.
#
# Unlike the client's guard this deliberately does NOT key on a declaration file:
# the hook resolves the `import` condition only, so a spec whose DTS pass never
# ran (OS_SKIP_DTS, or a DTS crash) is still complete for the injection.
SPEC_ESM="${SPEC_PKG}/dist/index.mjs"
SPEC_OPENAPI="${SPEC_PKG}/json-schema/openapi.json"
if [[ ! -f "$SPEC_ESM" || ! -f "$SPEC_OPENAPI" ]]; then
  echo "→ @objectstack/spec dist absent or incomplete — building it and its deps first..."
  (cd "$FRAMEWORK_ROOT" && pnpm exec turbo run build --filter=@objectstack/spec)
fi
export OBJECTSTACK_SPEC_DIST="$SPEC_PKG"
echo "→ Console will bundle @objectstack/spec from ${SPEC_PKG}"

pushd "$BUILD_ROOT" > /dev/null

# objectui's root package.json may pin packages that aren't available on
# every mirror. Fall back to the public registry just for this install.
NPM_CONFIG_REGISTRY_OVERRIDE="${OBJECTUI_NPM_REGISTRY:-https://registry.npmjs.org}"
npm_config_registry="$NPM_CONFIG_REGISTRY_OVERRIDE" \
  pnpm install --frozen-lockfile --prefer-offline --prod=false

# Build the console's workspace deps via turbo, then the SPA itself directly
# (see DEPS_BUILD_CMD/BUILD_CMD above for why these are split).
eval "$DEPS_BUILD_CMD"
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

# Assert the injected client actually landed in the bundle (see BUNDLE_CANARY).
if ! grep -rq "$BUNDLE_CANARY" "${TARGET}/assets"; then
  echo "✗ Built console dist does not contain '${BUNDLE_CANARY}' — the bundled"
  echo "  @objectstack/client is stale (OBJECTSTACK_CLIENT_DIST injection failed)."
  exit 1
fi
echo "✓ Bundle canary '${BUNDLE_CANARY}' present — framework client is in the bundle."

# Assert the injected SPEC landed too. Deliberately NOT a frozen literal like
# BUNDLE_CANARY above: "does the bundle carry the surface the framework declares
# now" is a moving target, and any string pinned here would be carried by the
# published spec within one release — after which it passes forever while proving
# nothing, which is the same silent pass this injection exists to remove. The
# script derives its probes from the two specs on disk on every run, and tests
# BOTH directions: the console bundle also holds a second, transitive copy of
# this tree's spec (pulled in through the injected client above), which makes a
# one-sided "is the new text present" probe pass even with no injection at all.
node "${FRAMEWORK_ROOT}/scripts/assert-console-spec-injection.mjs" \
  --injected "$SPEC_PKG" \
  --vendored "${BUILD_ROOT}/node_modules/@objectstack/spec" \
  --assets "${TARGET}/assets"

BYTES="$(du -sk "$TARGET" 2>/dev/null | awk '{print $1}')"
echo "✓ @objectstack/console dist ready (${BYTES} KB) from objectui@${PINNED_SHA:0:12}"

# ADR-0080/0081: the public-tier SDUI manifest and the spec↔registry react-block
# declaration-parity ratchet are intentionally NOT generated here — they require a
# real browser (Playwright) to enumerate the console registry, and the console
# build must not drag in a browser dependency. Regenerate them on demand instead:
#   pnpm sdui:manifest        (see scripts/gen-sdui-manifest.sh)
#
# The reminder names the TRIGGER, not just the command (#5960): `pnpm objectui:refresh`
# runs bump-objectui.sh and then this script, so this is the last output an operator
# sees while moving the pin — and the pin bump is the ratchet's only trigger, by
# decision. bump-objectui.sh prints the same step; this repeats it because that one
# has scrolled past a whole console build by now.
echo "ℹ SDUI manifest + declaration-parity ratchet are decoupled from the console build."
echo "  Run 'pnpm sdui:manifest' whenever you move the objectui pin — that is the"
echo "  ratchet's only trigger, on demand by decision (#5960). Requires Playwright."
