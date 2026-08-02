#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Register the repo's git integration in this clone (#4675).
 *
 * `.gitattributes` and `.githooks/` are committed, but neither takes effect on
 * its own: a merge driver must be named in `.git/config`, and hooks must be
 * pointed at by `core.hooksPath`. Both are per-clone by design — git will not
 * let a repository execute code on you just because you cloned it. So something
 * has to opt in locally, and `pnpm install` (`prepare`) is the one step every
 * contributor and agent already runs.
 *
 * Failing is not an option this script takes. An unregistered driver falls back
 * to git's default text merge — exactly the behaviour before #4675 — so a clone
 * where this cannot run is no worse off than it was. It therefore warns and
 * exits 0 on every failure path rather than breaking `pnpm install` (bare
 * checkouts, tarball extracts, containers without git, CI images that install
 * with `--ignore-scripts`).
 *
 * Idempotent: it writes only values that differ, so repeated installs are silent.
 *
 * Usage:
 *   node scripts/setup-git-hooks.mjs              # `prepare`
 *   node scripts/setup-git-hooks.mjs --self-test  # verify THIS clone is wired
 */

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DRIVER_NAME } from './regen-artifacts.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SETTINGS = [
  { key: `merge.${DRIVER_NAME}.name`, value: 'regenerate generator-owned artifacts instead of text-merging' },
  // %O %A %B %P — ancestor, ours (the output file), theirs, pathname. `node` and
  // a repo-relative path keep this working on Windows and in linked worktrees,
  // where a bare `./scripts/...` would resolve against the wrong root.
  { key: `merge.${DRIVER_NAME}.driver`, value: `node "${join(REPO_ROOT, 'scripts/git-merge-regen.mjs')}" %O %A %B %P` },
  { key: 'core.hooksPath', value: '.githooks' },
];

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function read(key) {
  try {
    return git(['config', '--local', '--get', key]).trim();
  } catch {
    return '';
  }
}

function main() {
  try {
    git(['rev-parse', '--is-inside-work-tree']);
  } catch {
    return; // Not a git worktree — nothing to register, nothing to warn about.
  }

  // A linked worktree shares `.git/config` with its main checkout, so this
  // registers once and covers every worktree an agent creates.
  const changed = [];
  for (const { key, value } of SETTINGS) {
    if (read(key) === value) continue;
    git(['config', '--local', key, value]);
    changed.push(key);
  }
  if (changed.length) console.log(`git integration registered (${changed.join(', ')})`);
}

if (process.argv.includes('--self-test')) {
  const wrong = SETTINGS.filter(({ key, value }) => read(key) !== value);
  for (const { key, value } of wrong) console.error(`✗ ${key} is "${read(key) || '<unset>'}", expected "${value}"`);
  if (!wrong.length) console.log(`✓ this clone has all ${SETTINGS.length} git settings registered`);
  else console.error('\n  Run `node scripts/setup-git-hooks.mjs` (or `pnpm install`) to register them.');
  process.exit(wrong.length ? 1 : 0);
}

try {
  main();
} catch (err) {
  // Warn, never fail: see the header. A clone without this is pre-#4675, not broken.
  console.warn(`git integration not registered (${err?.message ?? err}) — merges fall back to text merge.`);
}
