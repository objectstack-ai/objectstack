#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# Look inside a built framework build base image and fail when it is not the
# image docker/framework-build-base/Dockerfile promises:
#
#   bash docker/framework-build-base/check-image.sh <image ref> <40-hex framework sha>
#
# Run by .github/workflows/framework-build-base.yml against the image it just
# built (the pull-request dry run) or just pulled anonymously (a publish). The
# image must already be in the local Docker daemon. Prints one `key=value` line
# per reading, for the job summary.
set -euo pipefail

REF="${1:?usage: check-image.sh <image ref> <40-hex framework sha>}"
SHA="${2:?usage: check-image.sh <image ref> <40-hex framework sha>}"
case "$SHA" in
  *[!0-9a-f]*|'') echo "✗ framework sha must be 40 lowercase hex, got '$SHA'" >&2; exit 2 ;;
esac
[ "${#SHA}" -eq 40 ] || { echo "✗ framework sha must be 40 lowercase hex, got '$SHA'" >&2; exit 2; }

# Everything below runs inside the image, as the image's default user, with no
# network: what is asserted is what a downstream `FROM` gets.
docker run --rm --network none -e SHA8="${SHA:0:8}" "$REF" sh -eu -c '
  fw=/repo/objectstack
  fail() { echo "✗ $*" >&2; exit 1; }

  # Public image: no checkout metadata (it can carry a credentials header).
  [ ! -e "$fw/.git" ] || fail "$fw/.git is in the image"
  [ -z "$(find /repo -name .git -print -quit)" ] || fail "a .git directory is in the image"

  # Installed and built.
  [ -d "$fw/node_modules/.pnpm" ] || fail "$fw/node_modules was not installed by pnpm"
  [ -f "$fw/packages/spec/dist/index.js" ] || fail "@objectstack/spec was not built"
  [ -f "$fw/packages/core/dist/index.js" ] || fail "@objectstack/core was not built"

  # The Console: built into the directory the CLI serves, ui/ removed after.
  dist="$fw/packages/console/dist"
  [ -f "$dist/index.html" ] || fail "$dist/index.html is missing"
  [ ! -e "$fw/ui" ] || fail "$fw/ui is still in the image"
  # Its build identity is the first 8 hex of the framework commit.
  grep -rqF "$SHA8" "$dist" || fail "no Console asset names the build identity $SHA8"

  # The posture the downstream stage relies on.
  [ "${OS_SKIP_DTS:-}" = 1 ] || fail "OS_SKIP_DTS is not 1 in the image environment"

  echo "node=$(node --version)"
  echo "pnpm=$(pnpm --version)"
  echo "dist_dirs_under_packages=$(find "$fw/packages" -mindepth 2 -maxdepth 4 -type d -name dist -not -path "*/node_modules/*" | wc -l)"
  echo "console_assets=$(find "$dist" -type f | wc -l)"
'

echo "image_bytes=$(docker image inspect --format '{{.Size}}' "$REF")"
