#!/usr/bin/env bash
# ADR-0087 D4 — the release lane's acts on the two generated projections,
# `spec-changes.json` and the protocol upgrade guide.
#
#   bash scripts/release-spec-changes.sh --prepare    # BEFORE `changeset publish` (release.yml)
#   bash scripts/release-spec-changes.sh --generate   # BEFORE `changeset publish` (cut-rc.yml)
#   bash scripts/release-spec-changes.sh --verify     # after either, BEFORE `changeset publish`
#   bash scripts/release-spec-changes.sh --attach     # AFTER the GitHub Release exists
#
# WHERE THE PROJECTIONS COME FROM (#22449 B′). Both are pure functions of the
# ADR-0087 registries, and this lane is where the shipped copies are generated:
# `--prepare` and `--generate` write `packages/spec/spec-changes.json` (its
# per-major records and aggregate, from the registries) and
# `packages/spec/protocol-upgrade-guide.md` (`files[]` ships both) right before
# the tarball is packed. Nothing here reads a committed copy, so a committed
# copy that stopped being regenerated cannot reach npm or the Release. The
# pull-request stage generates the same two projections in memory with the same
# generators (`check:spec-changes`, `check:upgrade-guide`) and renders their
# diff against the base (`packages/spec/scripts/render-projection-diff.ts`).
#
# `--prepare` also writes the PER-RELEASE section into `spec-changes.json` so it
# ships INSIDE the tarball. Until #17080 the only copy carrying a real
# `added[]`/`removed[]` was the one attached to the GitHub Release: a consumer's
# tooling looks in `node_modules`, where a registry-only copy says
# `added: 0, removed: 0` — which reads as "nothing changed" across a MINOR that
# moved hundreds of exports. The section exists only in the published artifact,
# which is what the ruling's "generate at publish time only" means.
#
# `--generate` is the rc lane's half: the two registry projections and NO
# per-release section — what an rc tarball has always carried, now generated
# instead of copied out of the tree. It reads nothing from npm.
#
# `--verify` is the correctness gate, and it is part of acceptance, not a
# nicety. It packs the artifact this release would publish and refuses it, before
# anything reaches npm, when (1) its two projections differ from a FRESH
# generation from the registries — a `files[]` entry that stopped shipping one, a
# copy edited after the generator ran — or (2) after `--prepare`, when the
# per-release delta disagrees with the two TARBALLS. A wrong change file is worse
# than none.
#
# `--attach` uploads the same two files to the GitHub Release. It does NOT
# regenerate — the assets on the Release page and the files inside the tarball
# are then the same bytes by construction, rather than two runs that happened to
# agree. The Release itself is created by scripts/release-github-releases.mjs,
# which must run BEFORE this mode (`gh release upload` needs something to upload
# onto).
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
  --prepare|--generate|--verify|--attach) ;;
  *) echo "::error::unknown mode '${MODE}' (expected --prepare, --generate, --verify or --attach)"; exit 2 ;;
esac

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
workdir="${repo_root}/.release-spec-changes"
prev_dir="${workdir}/previous/package"
packed_dir="${workdir}/packed/package"
fresh_dir="${workdir}/fresh"
# Left by `--generate`: the run owes no per-release section, and `--verify` says
# so instead of refusing for want of a previous tarball.
registry_only_marker="${workdir}/registry-only"
manifest="${repo_root}/packages/spec/spec-changes.json"
guide="${repo_root}/packages/spec/protocol-upgrade-guide.md"

new_version=$(jq -r '.[] | select(.name=="@objectstack/spec") | .version' <<<"${PUBLISHED:-[]}")
if [ -z "${new_version}" ] || [ "${new_version}" = "null" ]; then
  new_version="${RELEASE_VERSION:-}"
fi
if [ -z "${new_version}" ]; then
  echo "::error::@objectstack/spec version unknown (neither publishedPackages nor RELEASE_VERSION) — cannot ${MODE#--} spec-changes.json"
  exit 1
fi

# The guide, from the registries, into the package — the same generator entry
# point the pull-request check runs in memory.
generate_guide() {
  pnpm --filter @objectstack/spec exec tsx scripts/build-upgrade-guide.ts --out "${guide}"
}

# ── --generate ────────────────────────────────────────────────────────────
if [ "${MODE}" = "--generate" ]; then
  rm -rf "${workdir}"
  mkdir -p "${workdir}"
  generate_guide
  pnpm --filter @objectstack/spec exec tsx scripts/build-spec-changes.ts
  : > "${registry_only_marker}"
  echo "Wrote the registry projections for ${new_version} (no per-release section on this lane) into packages/spec/"
  exit 0
fi

# ── --prepare ─────────────────────────────────────────────────────────────
if [ "${MODE}" = "--prepare" ]; then
  rm -rf "${workdir}/previous" "${registry_only_marker}"
  mkdir -p "${workdir}/previous"
  generate_guide

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
  if [ -d "${prev_dir}" ]; then
    release_section_args=(--previous "${prev_dir}")
  elif [ -f "${registry_only_marker}" ]; then
    release_section_args=(--no-release-section)
  else
    # The prepare step is what unpacks the previous tarball, and the generate
    # step is what says none is owed. Neither means the lane skipped that step or
    # it failed — either way nothing was measured, so this refuses rather than
    # passing a release nobody checked.
    echo "::error::${prev_dir} is missing — run 'bash scripts/release-spec-changes.sh --prepare' (or '--generate' on the rc lane) first. Nothing was verified."
    exit 1
  fi
  rm -rf "${workdir}/packed" "${fresh_dir}"
  mkdir -p "${workdir}/packed" "${fresh_dir}"
  # A FRESH generation of both projections from the registries, by the same
  # entry points `--prepare`/`--generate` ran. The packed copies must equal it.
  pnpm --filter @objectstack/spec exec tsx scripts/build-spec-changes.ts --out "${fresh_dir}/spec-changes.json"
  pnpm --filter @objectstack/spec exec tsx scripts/build-upgrade-guide.ts --out "${fresh_dir}/protocol-upgrade-guide.md"
  # The artifact this release would publish, produced by the same packer
  # `changeset publish` uses, so `files[]` applies exactly as it will.
  tarball=$(cd "${repo_root}/packages/spec" && pnpm pack --pack-destination "${workdir}/packed" --silent | tail -1)
  tar -xzf "${tarball}" -C "${workdir}/packed"
  node "${repo_root}/scripts/check-release-spec-changes.mjs" \
    "${release_section_args[@]}" --published "${packed_dir}" --registry "${fresh_dir}"
  exit 0
fi

# ── --attach ──────────────────────────────────────────────────────────────
for file in "${manifest}" "${guide}"; do
  if [ ! -f "${file}" ]; then
    echo "::error::${file} is missing — nothing to attach. '--prepare' (or '--generate') writes it before the publish."
    exit 1
  fi
done
# ONE upload call for both: either file failing to upload fails this step.
gh release upload "@objectstack/spec@${new_version}" "${manifest}" "${guide}" --clobber
echo "Attached spec-changes.json and protocol-upgrade-guide.md to release @objectstack/spec@${new_version}"
