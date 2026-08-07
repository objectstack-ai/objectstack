// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';

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
});
