#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# board-snapshot-r2-upload -- the body of board-snapshot.yml's "Upload the
# archive to R2" step (#26086), moved out of an inline `run:` block.
#
#   bash scripts/ci/board-snapshot-r2-upload.sh          # in the step, env from its `env:`
#   bash scripts/ci/board-snapshot-r2-upload.selftest.sh # offline: stub aws, throwaway archive
#
# The rationale (why mtimes come from history, why `--delete` is safe on this
# target, why unset secrets are a notice) stays in the workflow beside the step
# that runs this; the text below is the inline body, byte for byte, after the
# one line GitHub's default `bash -e {0}` shell supplied for it.
#
# Inputs: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION,
# AWS_REQUEST_CHECKSUM_CALCULATION, R2_ACCOUNT_ID, R2_BUCKET (the step's env),
# RUNNER_TEMP and GITHUB_OUTPUT (the runner's), and the `archive/` worktree in
# the current directory. ⛔ The secrets are read, never echoed.
set -e

set -euo pipefail

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ] \
   || [ -z "${R2_ACCOUNT_ID:-}" ] || [ -z "${R2_BUCKET:-}" ]; then
  echo "status=skipped — no R2 credentials configured in this repository" >> "$GITHUB_OUTPUT"
  echo "::notice::R2 upload skipped: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are not all set as repository secrets; this run is archived on the board-archive branch only."
  exit 0
fi

endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
mirror="s3://${R2_BUCKET}/objectstack/board/"

# The SOURCE is the snapshot directory, NOT the worktree root that
# contains it. The snapshot above is written to `archive/board`, so
# syncing `archive/` would map `archive/board/X` onto the `mirror`
# prefix as `objectstack/board/` + `board/X` — one segment deeper
# than the prefix on the line above says the mirror is, and visible
# only from the bucket side. Syncing `archive/board/` maps
# `archive/board/X` to `objectstack/board/X`, which is the layout a
# restore driven from the documented path looks for.
#
# `--delete` is kept and needs no migration step of its own: the
# stale `objectstack/board/board/` tree is inside this sync target
# and has no local counterpart, so the first run after this change
# removes it. ⛔ The target is never widened to `objectstack/` to
# achieve the same mapping — that would put `objectstack/snapshots/`
# inside a `--delete` target and eat the daily tarballs, the failure
# the comment above already warns about.
#
# No `.git` filter is needed here: `archive/` is a linked worktree,
# so its `.git` is a FILE at `archive/.git`, which is outside this
# source (filters match paths relative to the source directory).
#
# mtimes first: see "Only changed records are uploaded" above. The
# history is walked newest-first, so the first time a path appears
# is the last commit that touched it; a path whose newest commit
# deleted it has no file and is skipped. `-z` keeps every byte of a
# path intact. A truncated history errs in the safe direction only:
# its oldest commit looks like the one that created every file older
# than it, which stamps those files NEWER than their real last
# change, so they are uploaded again, and no stale object is ever
# skipped.
#
# The script is written to a file rather than fed through a heredoc
# inside the command substitution, which keeps bash's parser out of
# the backticks and quotes it contains.
cat > "$RUNNER_TEMP/archive-mtimes.cjs" <<'JS'
const { execFileSync } = require('node:child_process');
const { utimesSync } = require('node:fs');
const { join } = require('node:path');
const git = (...args) =>
  execFileSync('git', ['-C', 'archive', ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
const log = git('log', '--no-renames', '--name-only', '-z', '--format=%x01%ct', 'HEAD', '--', 'board');
const seen = new Set();
let time = NaN;
let stamped = 0;
for (const token of log.split('\0')) {
  if (token.startsWith('\x01')) { time = Number(token.slice(1)); continue; }
  const path = token.replace(/^\n/, '');
  if (!path || seen.has(path)) continue;
  seen.add(path);
  if (!Number.isInteger(time)) throw new Error(`no commit time read before ${path}`);
  try {
    utimesSync(join('archive', path), time, time);
    stamped += 1;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
const tracked = git('ls-files', '-z', '--', 'board').split('\0').filter(Boolean).length;
if (stamped !== tracked) throw new Error(`stamped ${stamped} file(s) but the archive tracks ${tracked}`);
const commits = git('rev-list', '--count', 'HEAD').trim();
console.log(`${stamped} file(s) stamped from ${commits} commit(s)`);
JS
if mtimes=$(node "$RUNNER_TEMP/archive-mtimes.cjs" 2>&1); then
  # The last line only: the status line below goes into
  # $GITHUB_OUTPUT, where a second line would break its format.
  mtime_note="mtimes from history: ${mtimes##*$'\n'}"
  echo "${mtime_note}"
else
  printf '%s\n' "$mtimes" >&2
  echo "::warning::Could not set the archive's mtimes from its git history (output above), so this sync re-uploads every object. The copy stays complete, but every file costs a Class A operation."
  mtime_note="FULL re-upload, mtimes not restored"
fi

# No pipe between the command and `$?` — see the snapshot step.
set +e
aws s3 sync archive/board/ "$mirror" \
  --endpoint-url "$endpoint" \
  --delete --no-progress \
  > "$RUNNER_TEMP/r2-sync.log" 2>&1
code=$?
set -e
if [ "$code" != "0" ]; then
  cat "$RUNNER_TEMP/r2-sync.log" >&2
  echo "status=FAILED — aws s3 sync exited $code" >> "$GITHUB_OUTPUT"
  echo "::error::aws s3 sync to R2 exited $code. This run IS archived on board-archive; the out-of-GitHub copy is now behind and every later run will stay behind until this is fixed."
  exit 1
fi
# One line per object moved. With the mtimes restored above, a run
# moves the records that changed since the last upload; a run that
# fell back (or the first one configured) moves the whole board, so
# the log is truncated here and the counts below are taken over all
# of it.
transfers=$(wc -l < "$RUNNER_TEMP/r2-sync.log")
head -n 50 "$RUNNER_TEMP/r2-sync.log"
if [ "$transfers" -gt 50 ]; then
  echo "... and $((transfers - 50)) further transfer line(s), not printed."
fi
uploaded=$(grep -c '^upload:' "$RUNNER_TEMP/r2-sync.log" || true)
deleted=$(grep -c '^delete:' "$RUNNER_TEMP/r2-sync.log" || true)

day=$(date -u +%Y-%m-%d)
tarball="s3://${R2_BUCKET}/objectstack/snapshots/${day}.tar.gz"
if aws s3 ls "$tarball" --endpoint-url "$endpoint" > /dev/null 2>&1; then
  tarred="already written for ${day}"
else
  tar -czf "$RUNNER_TEMP/${day}.tar.gz" --exclude=.git -C archive .
  aws s3 cp "$RUNNER_TEMP/${day}.tar.gz" "$tarball" \
    --endpoint-url "$endpoint" --no-progress
  tarred="written for ${day}"
fi

echo "status=synced ${uploaded} object(s), deleted ${deleted} (${mtime_note}); daily tarball ${tarred}" >> "$GITHUB_OUTPUT"
echo "R2: synced ${uploaded} object(s), deleted ${deleted} (${mtime_note}); daily tarball ${tarred}"
