// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import { memoryBackedTmpEnv } from '../../../scripts/vitest-memory-tmp.mjs';

// This package re-exported the shared preset until #27306. It now carries one
// key of its own, `test.env`, so the preset's one setting is restated below (a
// merged or wrapped preset is not what scripts/check-console-intercept-disarm.mjs
// judges in a config's place). Every other key stays on vitest's defaults, as
// under the bare re-export.
//
// `test.env` moves `os.tmpdir()` onto /dev/shm when it is writable
// (scripts/vitest-memory-tmp.mjs): the local and remote-face tests open `file:`
// databases in an `mkdtemp` under it. Measured on the 14 test files that do,
// beside four `dd … conv=fsync` writers on the same disk: 21 of 502 cases
// timed out across 4 files (inherited-members, external-object-parity,
// drift-detection, migration-entries) and the run took 211 s, against all
// green in 17 s idle; with TMPDIR there, under the same writers, all green in
// 17 s. Assertions and budgets are untouched.
export default defineConfig({
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
    env: memoryBackedTmpEnv(),
  },
});
