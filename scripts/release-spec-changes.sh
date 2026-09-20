#!/usr/bin/env bash
# ADR-0087 D4 — the release lane's three acts on `spec-changes.json`.
#
#   bash scripts/release-spec-changes.sh --prepare   # BEFORE `changeset publish`
#   bash scripts/release-spec-changes.sh --verify    # BEFORE `changeset publish`
#   bash scripts/release-spec-changes.sh --attach    # AFTER the GitHub Release exists
#
# `--prepare` writes the PER-RELEASE section into `packages/spec/spec-changes.json`
# so it ships INSIDE the tarball. Until #17080 the only copy carrying a real
# `added[]`/`removed[]` was the one attached to the GitHub Release: a consumer's
# tooling looks in `node_modules`, where the committed, registry-only copy says
# `added: 0, removed: 0` — which reads as "nothing changed" across a MINOR that
# moved hundreds of exports. The committed copy stays registry-derived and
# deterministic; the section exists only in the published artifact, which is
# what the ruling's "generate at publish time only" means.
#
# `--verify` is the correctness gate, and it is part of acceptance, not a
# nicety: the delta this lane generated is recomputed from the two TARBALLS and
# a mismatch fails the release before anything reaches npm. A wrong change file
# is worse than none.
#
# `--attach` uploads the same file to the GitHub Release. It does NOT regenerate
# — the artifact on the Release page and the one inside the tarball are then the
# same bytes by construction, rather than two runs that happened to agree. The
# Release itself is created by scripts/release-github-releases.mjs, which must
# run BEFORE this mode (`gh release upload` needs something to upload onto).
#
# Inputs (env):
#   PUBLISHED        — the changesets action's `publishedPackages` JSON array
#   RELEASE_VERSION  — the version this run is publishing; the fallback for the
#                      recovery publish path, which produces no such JSON, and
#                      the only source on the pre-publish modes (nothing has been
#                      published yet when they run)
#   GH_TOKEN         — token for `gh release upload` (`--attach` only)
set -euo pipefail

MODE="${1:---attach}"
case "${MODE}" in
  --prepare|--verify|--attach) ;;
  *) echo "::error::unknown mode '${MODE}' (expected --prepare, --verify or --attach)"; exit 2 ;;
esac

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
workdir="${repo_root}/.release-spec-changes"
prev_dir="${workdir}/previous/package"
packed_dir="${workdir}/packed/package"

new_version=$(jq -r '.[] | select(.name=="@objectstack/spec") | .version' <<<"${PUBLISHED:-[]}")
if [ -z "${new_version}" ] || [ "${new_version}" = "null" ]; then
  new_version="${RELEASE_VERSION:-}"
fi
if [ -z "${new_version}" ]; then
  echo "::error::@objectstack/spec version unknown (neither publishedPackages nor RELEASE_VERSION) — cannot ${MODE#--} spec-changes.json"
  exit 1
fi

# ── --prepare ─────────────────────────────────────────────────────────────
if [ "${MODE}" = "--prepare" ]; then
  rm -rf "${workdir}/previous"
  mkdir -p "${workdir}/previous"

  # Previous published version = newest on npm that isn't the one we are about
  # to publish. Before the publish that number is simply absent from the list,
  # and the filter keeps this correct on the repair path, where it is not.
  prev_version=$(npm view @objectstack/spec versions --json \
    | jq -r --arg v "${new_version}" '[.[] | select(. != $v)] | last // empty')

  if [ -z "${prev_version}" ]; then
    # The first publish ever. Nothing to diff against, and the generator is run
    # without the flag so the tarball carries the registry-only manifest.
    echo "::notice::no previously published @objectstack/spec — no per-release section for ${new_version}"
    pnpm --filter @objectstack/spec exec tsx scripts/build-spec-changes.ts
    exit 0
  fi

  echo "Diffing @objectstack/spec@${new_version} against previously published ${prev_version}"
  tarball=$(cd "${workdir}/previous" && npm pack "@objectstack/spec@${prev_version}" --silent)
  # The whole `package/` root is unpacked, not just the surface: the generator
  # reads the previous VERSION from its package.json and the previous registry
  # ids from its spec-changes.json, so nothing about the previous release is
  # transcribed by hand. Three surface shapes exist across history (the
  # `api-surface/` directory from #5837, the single `api-surface.json` from
  # protocol 15, neither before that) and the generator reads whichever this one
  # shipped — a published tarball is immutable, so there is no producer to fix.
  tar -xzf "${workdir}/previous/${tarball}" -C "${workdir}/previous"

  pnpm --filter @objectstack/spec exec tsx scripts/build-spec-changes.ts --previous-package "${prev_dir}"
  echo "Wrote the ${prev_version} → ${new_version} section into packages/spec/spec-changes.json"
  exit 0
fi

# ── --verify ──────────────────────────────────────────────────────────────
if [ "${MODE}" = "--verify" ]; then
  if [ ! -d "${prev_dir}" ]; then
    # The prepare step is what unpacks it. Missing means the lane skipped that
    # step or it failed — either way nothing was measured, so this refuses
    # rather than passing a release nobody checked.
    echo "::error::${prev_dir} is missing — run 'bash scripts/release-spec-changes.sh --prepare' first. Nothing was verified."
    exit 1
  fi
  rm -rf "${workdir}/packed"
  mkdir -p "${workdir}/packed"
  # The artifact this release would publish, produced by the same packer
  # `changeset publish` uses, so `files[]` applies exactly as it will.
  tarball=$(cd "${repo_root}/packages/spec" && pnpm pack --pack-destination "${workdir}/packed" --silent | tail -1)
  tar -xzf "${tarball}" -C "${workdir}/packed"
  node "${repo_root}/scripts/check-release-spec-changes.mjs" --previous "${prev_dir}" --published "${packed_dir}"
  exit 0
fi

# ── --attach ──────────────────────────────────────────────────────────────
if [ ! -f "${repo_root}/packages/spec/spec-changes.json" ]; then
  echo "::error::packages/spec/spec-changes.json is missing — nothing to attach"
  exit 1
fi
gh release upload "@objectstack/spec@${new_version}" "${repo_root}/packages/spec/spec-changes.json" --clobber
echo "Attached spec-changes.json to release @objectstack/spec@${new_version}"
