#!/usr/bin/env bash
# release-snapshot-publish.sh — the npm publish of release.yml's `next` snapshot
# lane (ADR-0125, amendment of 2026-11-05; ruling record 6663894403).
#
#   bash scripts/release-snapshot-publish.sh      # from release.yml's `snapshot-next` job only
#
# The snapshot counterpart of scripts/release-publish.sh, with every act a
# snapshot must not perform taken out: no npm publish record for the stable
# read-back, and ⛔ no `git push origin --tags` — `--no-git-tag` below means no
# tag is even created, and the job's checkout holds no credential that could
# push one. It runs, in order:
#
#   1. `node ui/scripts/check-published-dist-tooling.mjs --no-build`, the same
#      refusal the stable publish runs: no published @object-ui package carries
#      tooling material (a test, a mock, a `*.tsbuildinfo`) or lacks its build.
#      `--no-build` because the build the job ran is what gets packed;
#   2. npm's answer record, started exactly as scripts/release-publish.sh starts
#      it (`release-verify-npm.mjs --start-npm-record`, `npm_config_logs_dir`,
#      `npm_config_logs_max`), so the job's `release-verify-npm.mjs` read-back
#      names what npm answered for a package it cannot read;
#   3. the ruling's command, `changeset publish --tag next --no-git-tag`;
#   4. `release-verify-npm.mjs --npm-answers`, npm's answer per package, printed
#      whatever the publish's exit, which the script then exits with.
#
# What makes the tag `next` and only `next` is not this file: the job runs
# `node scripts/ci/snapshot-next.mjs guard` first, and that script's header
# lists the four ways a package could reach another dist-tag and the check that
# closes each. Its `--self-test` pins this file to exactly one publish line,
# spelled as above, and to none of the stable lane's post-publish acts.
#
# ⛔ Never run by hand and never by an AI seat (AGENTS.md Prime Directive 15):
# this IS a publish. A dry run that publishes nothing is
# `node scripts/ci/snapshot-next.mjs dry-run`.
set -euo pipefail

# ⛔ Do not restore npm_config_globalconfig — scripts/release-publish.sh's header
# is the measurement. `changeset publish` v3 shells out to a nested pnpm per
# package, which would hand npm one file as both its user and its global
# config, and npm aborts before it parses argv. The caller wrote NPM_TOKEN to
# $HOME/.npmrc, npm's user config, which this keeps.
unset npm_config_globalconfig NPM_CONFIG_GLOBALCONFIG

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${repo_root}"
# The workspace's own @changesets/cli, the one the guard read.
PATH="${repo_root}/node_modules/.bin:${PATH}"

if ! node ui/scripts/check-published-dist-tooling.mjs --no-build; then
  echo "::error::check-published-dist-tooling found tooling material in (or no build output for) a published @object-ui package. Refusing to publish the snapshot; the scan above names each package and file."
  exit 1
fi

# Keep npm's own answer for every package — scripts/release-publish.sh's
# header has the measurement: `changeset publish` keeps none of npm's output,
# and npm's debug log of each run (its `http fetch PUT <status>` line included)
# is what tells "accepted, registry slow" from "refused" or "never uploaded".
# After the scan on purpose: its `npm pack --dry-run` runs stay out of the
# record. Only npm's log settings change here.
NPM_RECORD_DIR="$(node scripts/release-verify-npm.mjs --start-npm-record)"
export npm_config_logs_dir="$NPM_RECORD_DIR"
export npm_config_logs_max=100000

publish_status=0
changeset publish --tag next --no-git-tag || publish_status=$?

# npm's answer per package, printed before anything else can fail. A report,
# never the verdict: the job's read-back reads the record again and fails closed.
node scripts/release-verify-npm.mjs --npm-answers \
  || echo "::warning::could not print npm's per-package answers; scripts/release-verify-npm.mjs reads the record again."

exit "$publish_status"
