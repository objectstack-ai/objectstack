// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Run-level half of the dogfood suite's per-file working directory (#21914).
// The per-file half, and the guard, live in `./per-file-cwd.setup.ts`. Both are
// wired in `../vitest.config.ts`.
//
// At the START of a run it does two things:
//
//   1. It clears a stale `packages/qa/dogfood/.objectstack`. Such a directory is
//      left by a developer's earlier run on a tree without this isolation, or by
//      a crashed run. The guard judges only what THIS run leaves, so an old
//      leftover never reds a run that wrote nothing.
//   2. It reserves a TAG for the run, `os-dogfood-run-XXXXXX`, as a directory
//      `mkdtempSync` creates under the system temp directory, and hands the tag
//      (a name, never a path) to every worker through `provide` / `inject`.
//      Each test file makes its own working directory directly under the system
//      temp directory, named `<tag>-file-XXXXXX`.
//
// At the END of the run it removes every directory whose name starts with this
// run's `<tag>-file-`, then the reservation itself. Another run's directories
// carry another tag, so a concurrent run on the same machine is never touched.
// The removal is run-level, not per-file: on the `shared-showcase` project
// (`isolate: false`) one memoized boot serves every file on a worker, and its
// SQLite handles stay open in the directory of the file that booted it.
//
// Why a tag and not a shared parent path (#21924): every `mkdtempSync` base in
// this tree must be one the tree's scratch-directory scan can read, so that an
// in-tree fixture root can never hide behind an expression
// (`scripts/pm/dispatch-gates.mjs`, "no mkdtempSync site in this tree takes a
// base the scan cannot read"). A path handed over through `inject()` is such an
// expression. `join(tmpdir(), ...)` is not: it is outside the tree by
// construction, whatever name follows it.
//
// ⛔ This teardown never JUDGES anything. On vitest 4.1.11 an error thrown from
// a globalSetup teardown is printed as `error during close` and the run still
// exits 0 (measured), so a guard placed here would be a false green. The guard
// is a throwing `afterAll` in the per-file module, which fails a test file.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

/** `packages/qa/dogfood`, resolved from this module's own location. */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

declare module 'vitest' {
  export interface ProvidedContext {
    /** The run's tag; each test file makes its working directory as `join(tmpdir(), '<tag>-file-')`. */
    dogfoodRunTag: string;
  }
}

/** The prefix of every per-file directory a run tagged `tag` creates under the system temp directory. */
export function perFileDirPrefix(tag: string): string {
  return `${tag}-file-`;
}

let reservation: string | undefined;

export function setup(project: TestProject): void {
  rmSync(join(PACKAGE_ROOT, '.objectstack'), { recursive: true, force: true });
  reservation = mkdtempSync(join(tmpdir(), 'os-dogfood-run-'));
  project.provide('dogfoodRunTag', basename(reservation));
}

export function teardown(): void {
  if (!reservation) return;
  const prefix = perFileDirPrefix(basename(reservation));
  for (const name of readdirSync(tmpdir())) {
    if (name.startsWith(prefix)) rmSync(join(tmpdir(), name), { recursive: true, force: true });
  }
  rmSync(reservation, { recursive: true, force: true });
}
