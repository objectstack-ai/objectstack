// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import { memoryBackedTmpEnv } from '../../../scripts/vitest-memory-tmp.mjs';

// This package re-exported the shared preset until #27076. It now carries one
// key of its own, `test.env.TMPDIR`, so the preset's one setting is restated
// below (a merged or wrapped preset is not what
// scripts/check-console-intercept-disarm.mjs judges in a config's place).
// Every other key stays on vitest's defaults (`globals: false`,
// `environment: 'node'`), exactly as under the bare re-export.
//
// ## Why TMPDIR points at a memory-backed directory
//
// The persistence tests write a real database file under `os.tmpdir()`, and
// every flush ends in `atomicWriteFile`'s `handle.sync()` (fsync before the
// rename; see wasm-connection.ts). An fsync waits for the disk's queue, and on
// a Test Core shard that queue belongs to the other suites sharing the runner.
// Measured (#27076): `should persist data on-write` takes about 30 ms on an
// idle disk and 5,026 ms on schedule run 40654333991 (Test Core 6/8), where it
// timed out; run 39853791549 timed out five on-write and flush cases the same
// way. Locally, with four `dd … conv=fsync` writers on the same disk, those
// cases took 1.4–3.6 s; with TMPDIR on /dev/shm under the same writers, every
// case in the four persistence files stayed under 0.6 s.
//
// So the cases' wall time measured the neighbours' disk, not the driver. On a
// tmpfs the same code still runs, `sync()` included: what each case asserts
// (bytes on disk, atomic rename, the flush chain, the failure report) is
// unchanged; only the wait for unrelated I/O is gone. Budgets, fixtures and
// cases are untouched. The setting itself, and the host without a writable
// /dev/shm, live in scripts/vitest-memory-tmp.mjs, shared since #27306 with the
// other packages whose tests write SQLite files under `os.tmpdir()`.

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
