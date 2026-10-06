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
//   2. It creates ONE temporary root for the run and hands it to every worker
//      through `provide` / `inject`. Each test file makes its own working
//      directory under that root.
//
// At the END of the run it removes that root, and with it every per-file
// directory. The removal is run-level, not per-file: on the `shared-showcase`
// project (`isolate: false`) one memoized boot serves every file on a worker,
// and its SQLite handles stay open in the directory of the file that booted it.
//
// ⛔ This teardown never JUDGES anything. On vitest 4.1.11 an error thrown from
// a globalSetup teardown is printed as `error during close` and the run still
// exits 0 (measured), so a guard placed here would be a false green. The guard
// is a throwing `afterAll` in the per-file module, which fails a test file.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

/** `packages/qa/dogfood`, resolved from this module's own location. */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

declare module 'vitest' {
  export interface ProvidedContext {
    /** The run's temporary root; each test file makes its working directory under it. */
    dogfoodCwdRoot: string;
  }
}

let runRoot: string | undefined;

export function setup(project: TestProject): void {
  rmSync(join(PACKAGE_ROOT, '.objectstack'), { recursive: true, force: true });
  runRoot = mkdtempSync(join(tmpdir(), 'os-dogfood-run-'));
  project.provide('dogfoodCwdRoot', runRoot);
}

export function teardown(): void {
  if (runRoot) rmSync(runRoot, { recursive: true, force: true });
}
