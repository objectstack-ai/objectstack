#!/usr/bin/env bash
# ADR-0087 D4 — build the release `spec-changes.json` (the registry projection
# joined with the api-surface diff against the PREVIOUSLY PUBLISHED spec — the
# ADR-0059 §3 gate artifact, reused instead of discarded) and attach it to the
# `@objectstack/spec@<version>` GitHub Release.
#
# The Release itself is created by scripts/release-github-releases.mjs, which
# must run BEFORE this script — `gh release upload` needs something to upload
# onto (#4900).
#
# Inputs (env):
#   PUBLISHED        — the changesets action's `publishedPackages` JSON array
#   RELEASE_VERSION  — fallback for the recovery publish path, which produces no
#                      such JSON; the fixed group releases every package at one
#                      version, so spec's version is that version
#   GH_TOKEN         — token for `gh release upload`
set -euo pipefail

new_version=$(jq -r '.[] | select(.name=="@objectstack/spec") | .version' <<<"${PUBLISHED:-[]}")
if [ -z "${new_version}" ] || [ "${new_version}" = "null" ]; then
  new_version="${RELEASE_VERSION:-}"
fi
if [ -z "${new_version}" ]; then
  echo "::error::@objectstack/spec version unknown (neither publishedPackages nor RELEASE_VERSION) — cannot attach spec-changes.json"
  exit 1
fi

# Previous published version = newest on npm that isn't the one just published.
prev_version=$(npm view @objectstack/spec versions --json \
  | jq -r --arg v "${new_version}" '[.[] | select(. != $v)] | last // empty')

workdir=$(mktemp -d)
prev_surface=""
if [ -n "${prev_version}" ]; then
  echo "Diffing the export surface against previously published @objectstack/spec@${prev_version}"
  tarball=$(cd "${workdir}" && npm pack "@objectstack/spec@${prev_version}" --silent)
  # Three shapes, because a published tarball is immutable and we unpack whichever
  # one that release shipped:
  #   - `package/api-surface/`     — sharded by entry point, #5837 onward;
  #   - `package/api-surface.json` — the single file, protocol 15 .. #5837;
  #   - neither                    — before protocol 15.
  tar -xzf "${workdir}/${tarball}" -C "${workdir}" package/api-surface 2>/dev/null || true
  tar -xzf "${workdir}/${tarball}" -C "${workdir}" package/api-surface.json 2>/dev/null || true
  if [ -d "${workdir}/package/api-surface" ]; then
    prev_surface="${workdir}/package/api-surface"
  elif [ -f "${workdir}/package/api-surface.json" ]; then
    prev_surface="${workdir}/package/api-surface.json"
  else
    # Releases before protocol 15 did not ship an export snapshot in the npm
    # artifact; the manifest is still attached, with empty added[]/removed[].
    echo "@objectstack/spec@${prev_version} ships no api-surface snapshot — added/removed stay empty"
  fi
fi

if [ -n "${prev_surface}" ]; then
  pnpm --filter @objectstack/spec exec tsx scripts/build-spec-changes.ts --previous-surface "${prev_surface}"
else
  pnpm --filter @objectstack/spec exec tsx scripts/build-spec-changes.ts
fi

gh release upload "@objectstack/spec@${new_version}" packages/spec/spec-changes.json --clobber
echo "Attached spec-changes.json to release @objectstack/spec@${new_version}"
