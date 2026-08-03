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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GIT_SETTINGS } from './regen-artifacts.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// What gets registered lives in `regen-artifacts.mjs` — one declaration, read both
// by this registrar and by the `--self-test` gate that verifies it (#4868).
//
// The driver value is deliberately NOT an absolute path any more. It must satisfy
// two constraints at once, and the obvious spellings each satisfy only one:
//
//   - It must not bind to one specific worktree. Baking an absolute
//     `${REPO_ROOT}/scripts/...` in here did exactly that: linked worktrees SHARE
//     one `.git/config`, so every `pnpm install` re-pointed the container-wide
//     driver at the installing worktree, and the moment that worktree was removed
//     — which AGENTS.md *requires* on task cleanup — every merge of a
//     `merge=os-regen` path in every other worktree died with MODULE_NOT_FOUND.
//     Observed drifting across four worktrees before anyone noticed.
//   - It must still resolve to the right root. A bare `./scripts/...` relies on
//     git's (undocumented) choice of cwd for merge drivers, which is what the
//     absolute path was originally there to avoid.
//
// `$(git rev-parse --show-toplevel)` satisfies both: git runs merge drivers
// through a shell, so the substitution happens per invocation, inside the worktree
// being merged. Verified in git 2.43 from a linked worktree, invoked from both the
// worktree root and a subdirectory.
//
// Two traps, both verified empirically rather than assumed:
//   - NO leading `!`. That prefix is alias/credential-helper syntax; a merge driver
//     value is already handed to the shell verbatim, so `!node ...` runs a program
//     literally named `!node` — "not found", and git falls back to a text merge.
//   - The placeholders stay UNQUOTED. git substitutes %O %A %B as generated temp
//     names and already shell-quotes %P itself; wrapping them in quotes of our own
//     hands the driver a pathname with literal quote characters in it.
const SETTINGS = GIT_SETTINGS;

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
