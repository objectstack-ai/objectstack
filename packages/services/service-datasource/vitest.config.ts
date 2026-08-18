// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    // This package had no vitest config at all, so every case ran under
    // vitest's 5000ms default — the structural hole #4856 could not cover
    // (it set per-package timeouts in each package's own vitest.config.ts,
    // and this package had none). The cases that build a REAL driver pay a
    // one-time `@objectstack/driver-sql` (knex) import inside the first case
    // that reaches it: measured idle that case runs ~1.1s
    // (datasource-pool-support "sqlite WITHOUT a pool"), leaving ~4.6x
    // headroom that a loaded merge-queue runner eats — the #6044 signature
    // (green on every PR branch, intermittently red only in queue full
    // builds). 60s reuses #4856's value rather than inventing a new number,
    // set at the config layer so future cases are covered on arrival.
    testTimeout: 60_000,
  },
  resolve: {
    // `@objectstack/core` became a VALUE import of this package's source when
    // the datasource-admin routes took on the platform's authentication floor
    // (#9391): they read the shared anonymous-deny decision and the shared
    // identity resolution from it. Without this alias that import would follow
    // the workspace link to `packages/core/dist/index.js` — a build artifact —
    // and every case in this package touching the guard would be reporting on
    // build state rather than on the source next to it. A dist merely BEHIND
    // rather than missing the symbol is the dangerous direction: the pin runs
    // GREEN against core's old behaviour with nothing in the output saying so,
    // which on an authentication path means a green suite over an unguarded
    // seam. `check:test-source-alias` is the gate; this is its intended repair
    // (alias the import, never widen the baseline).
    //
    // Array form with an anchored pattern, deliberately: the object form
    // matches by PREFIX, so a bare `@objectstack/core` entry would also swallow
    // `@objectstack/core/logger` and resolve it to `core/src/index.ts/logger`
    // (ENOTDIR). Same shape as `service-storage` and `service-knowledge`.
    alias: [{ find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') }],
  },
});
