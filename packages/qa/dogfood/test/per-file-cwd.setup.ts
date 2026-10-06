// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Every dogfood test file runs in its OWN temporary working directory (#21914).
// Wired as `setupFiles` in BOTH projects of `../vitest.config.ts`; the run-level
// half is `./per-file-cwd.global-setup.ts`.
//
// ## Why
//
// The showcase declares its external datasource with a cwd-relative file,
// `.objectstack/data/showcase_external.db`. Every showcase boot auto-connects
// it, and SQLite CREATES the file when it is missing. The showcase's `onEnable`
// also provisions its federated tables there. Before this module, every file
// that booted the showcase from `packages/qa/dogfood` left that database in the
// package directory: 92 files (measured), 7 of them with the tables populated.
// A later boot on the same runner then found or missed the federated tables
// depending on which files ran before it, so its outcome depended on shard
// composition and file order.
//
// ## What it does
//
// At module top level, which runs before the test file's own imports, it makes
// a directory directly under the system temp directory, named with the run's
// tag (`<tag>-file-XXXXXX`), and `chdir`s into it. `afterAll` restores the
// previous working directory. The directories are removed at the end of the
// run by the globalSetup, which sweeps its own tag, not here: the memoized
// `shared-showcase` boot keeps its SQLite handles open in the first file's
// directory.
//
// The base is spelled `join(tmpdir(), ...)` on purpose (#21924): the tree's
// scratch-directory scan must be able to read every `mkdtempSync` base, and a
// path received through `inject()` is one it cannot read. Only the run's TAG
// comes through `inject()`, as a name component, and it is refused below if
// it could carry a separator.
//
// The invariant for every dogfood author: a file runs in its own temporary
// cwd, so anything cwd-relative it writes is its own and disappears with the
// run. A file that READS a package-relative path must resolve it from its
// module's location (`new URL('..', import.meta.url)`), never from
// `process.cwd()`.
//
// ## The guard
//
// `afterAll` THROWS when `packages/qa/dogfood/.objectstack/data` exists, so a
// file that writes outside its temporary cwd fails the run. The globalSetup
// clears a stale directory at the start of the run, so the guard judges only
// what this run leaves.
import { afterAll, inject } from 'vitest';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { perFileDirPrefix } from './per-file-cwd.global-setup.js';

/** `packages/qa/dogfood`, resolved from this module's own location. */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** What a file must never leave in the package directory. */
const LEFTOVER = join(PACKAGE_ROOT, '.objectstack', 'data');

const runTag = inject('dogfoodRunTag');
if (!runTag) {
  throw new Error(
    'per-file-cwd.setup.ts: no run tag was provided. The globalSetup ' +
      '`test/per-file-cwd.global-setup.ts` must be wired in packages/qa/dogfood/vitest.config.ts; ' +
      'without it this file would run in the package directory.',
  );
}
if (/[\\/]|\.\./.test(runTag)) {
  throw new Error(`per-file-cwd.setup.ts: the run tag ${JSON.stringify(runTag)} is not a plain directory name.`);
}

const previousCwd = process.cwd();
const presentAtStart = existsSync(LEFTOVER);
process.chdir(mkdtempSync(join(tmpdir(), perFileDirPrefix(runTag))));

afterAll(() => {
  process.chdir(previousCwd);
  if (!existsSync(LEFTOVER)) return;
  let entries: string;
  try {
    entries = readdirSync(LEFTOVER).join(', ') || '(empty)';
  } catch (e) {
    entries = `(unreadable: ${(e as Error).message})`;
  }
  throw new Error(
    `${LEFTOVER} exists after this test file ran. Entries: ${entries}. ` +
      'Every dogfood file runs in its own temporary working directory ' +
      '(test/per-file-cwd.setup.ts), so something wrote into the package directory instead: ' +
      'an absolute path built from the package root, or a process.chdir() back to it before a boot. ' +
      'Fix the writer so it writes only relative to its own working directory. ' +
      'The file named here may not be the writer: a file running at the same time on another ' +
      `worker can leave it too. It was ${presentAtStart ? 'ALREADY present' : 'absent'} ` +
      'when this file started.',
  );
});
