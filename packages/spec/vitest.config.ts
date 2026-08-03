// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // [#4796] This package carries 13 export-surface pin tests (one per
    // retirement/dual-source PR) that each build a ts.createProgram over all
    // 16 public entry points — inherently seconds-scale work. Measured cost:
    // ~2-3s on an idle machine, 5.0-5.6s on a CI shard where turbo runs
    // @objectstack/spec#build CONCURRENTLY on the same 4 vCPUs. vitest's 5s
    // default sat exactly on that line: three pins timed out in one morning
    // (state-machine / sync-retirement / tenant), each ejecting an unrelated
    // PR from the merge queue. 30s is ~5x the measured contended worst case;
    // genuine hangs are still caught by CI's 10-minute stall guard
    // (run-with-stall-guard.mjs), which is the real hang detector — this
    // number only stops healthy-but-contended runs from reading as failures.
    // The durable fix — precompute the export surface as a build artifact and
    // have the pins compare instead of re-resolving — is tracked in #4796.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.zod.ts'],
      exclude: ['node_modules', 'dist', 'scripts'],
    },
  },
});
