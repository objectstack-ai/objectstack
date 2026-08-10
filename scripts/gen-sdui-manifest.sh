#!/usr/bin/env bash
# ADR-0080/0081: generate the public-tier SDUI component manifest and ratchet the
# spec↔frontend react-block conformance.
#
# This is deliberately SEPARATE from build-console.sh and is NOT part of the
# default build. The console component registry is a browser app (plugin-map /
# charts pull browser-only deps), so the only reliable way to enumerate it is to
# load the built `manifest-dump.html` in a real browser and read
# `window.__MANIFEST`. We do not want every console rebuild to drag in a
# Playwright browser dependency, so this step is opt-in / on-demand:
#
#   pnpm objectui:build      # (re)build + vendor the console dist at .objectui-sha
#   pnpm sdui:manifest       # then dump the manifest + ratchet conformance
#
# Requires a matching Playwright browser. If it complains the executable is
# missing, install it:
#
#   pnpm exec playwright install chromium-headless-shell
#
# Output: packages/console/dist/sdui.manifest.json  (consumed by the os-build
# JSX gate for full component/prop validation; absent -> gate falls back to
# parse-level).

set -euo pipefail

FRAMEWORK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHA_FILE="${FRAMEWORK_ROOT}/.objectui-sha"

if [[ ! -f "$SHA_FILE" ]]; then
  echo "✗ ${SHA_FILE} is missing — cannot determine which objectui commit to use."
  exit 1
fi
PINNED_SHA="$(tr -d '[:space:]' < "$SHA_FILE")"

BUILD_ROOT="${FRAMEWORK_ROOT}/.cache/objectui-${PINNED_SHA:0:12}"
TARGET="${FRAMEWORK_ROOT}/packages/console/dist"
DUMP_PAGE="${BUILD_ROOT}/apps/console/dev/manifest-dump.html"
DUMP_SCRIPT="${BUILD_ROOT}/scripts/dump-public-manifest.mjs"

if [[ ! -d "$BUILD_ROOT" ]]; then
  echo "✗ objectui build tree not found at ${BUILD_ROOT}"
  echo "  Run 'pnpm objectui:build' first to vendor the console at the pinned SHA."
  exit 1
fi
if [[ ! -f "$DUMP_PAGE" || ! -f "$DUMP_SCRIPT" ]]; then
  echo "ℹ manifest dump tooling not present at objectui@${PINNED_SHA:0:12} — nothing to do."
  echo "  (bump .objectui-sha to >=96b1293 to enable full JSX validation)"
  exit 0
fi

echo "→ Generating SDUI public-tier manifest (ADR-0080) from objectui@${PINNED_SHA:0:12}..."
pushd "$BUILD_ROOT" > /dev/null
pnpm --filter @object-ui/console exec vite dev --port 5180 > /tmp/sdui-dump-dev.log 2>&1 &
DUMP_DEV_PID=$!
trap 'kill "$DUMP_DEV_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do curl -sf "http://localhost:5180/" > /dev/null 2>&1 && break; sleep 1; done

if BASE_URL="http://localhost:5180" OUT="${TARGET}/sdui.manifest.json" node scripts/dump-public-manifest.mjs; then
  echo "✓ wrote ${TARGET}/sdui.manifest.json"
else
  status=$?
  echo "✗ manifest generation failed (exit ${status})."
  echo "  If Playwright reported a missing browser, install it and retry:"
  echo "    pnpm exec playwright install chromium-headless-shell"
  echo "  Can't install here (e.g. an agent dispatch container)? See docs/releases-maintenance.md"
  echo "  'If the dispatch container's Playwright browser doesn't match the revision'."
  popd > /dev/null
  exit "$status"
fi
popd > /dev/null

# ADR-0081/0082: ratchet the spec↔registry react-block DECLARATION PARITY against
# the committed baseline.
#
# `--strict`, i.e. this now GATES. It used to run without it and swallow the exit
# code behind a `⚠`, so "divergence recorded" and "divergence stopped" were two
# very different things wearing the same green build (#4472, secondary finding 1).
# The ratchet only fires on divergence NEW since the accepted baseline, so a
# failure here is a deliberate registry change that needs either a spec/overlay
# edit or an explicit `--update` to accept — never pre-existing noise.
#
# Scope, since a green line here is easy to over-read: this compares two
# DECLARATIONS (spec zod props vs registry-declared inputs) and inspects no
# renderer. See the header of check-react-blocks-declaration-parity.ts.
if [[ -f "${FRAMEWORK_ROOT}/packages/spec/react-declaration-parity.baseline.json" ]]; then
  echo "→ Ratcheting spec↔registry react-block declaration parity (ADR-0082)..."
  ( cd "${FRAMEWORK_ROOT}" && MANIFEST="${TARGET}/sdui.manifest.json" \
    pnpm --filter @objectstack/spec check:react-declaration-parity \
    --baseline react-declaration-parity.baseline.json --strict )
fi
