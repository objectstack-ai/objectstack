// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // 12 tests in this package load the TypeScript compiler and type-resolve the
    // whole export surface (ts.createProgram + getTypeChecker). That is seconds of
    // work per case, and vitest's 5000ms default left no headroom on a loaded merge
    // queue runner — see #4850. Set at the config layer so all 12 (and any future
    // one) are covered, rather than per-case as PR #4506 did. Related: #4796.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.zod.ts'],
      exclude: ['node_modules', 'dist', 'scripts'],
    },
  },
});
