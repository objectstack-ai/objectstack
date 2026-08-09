// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // The 17 export-surface pins that used to load the TypeScript compiler and
    // type-resolve the whole export surface inside a test case no longer do:
    // #4796 lifted that resolution into the `export-origins/` build-time
    // baseline and the pins now compare against it. This value is what remains
    // of the two stop-the-bleed laps (#4850 → 60s, #4864 → 30s) that kept those
    // cases off vitest's 5000ms default while they still compiled.
    //
    // Keep it. Two `createProgram` cases survive deliberately —
    // `data/driver.test.ts` and `ui/app.test.ts` assert TYPE WRITABILITY of
    // retired keys, which is a different fact from export origin and which no
    // export-surface baseline can carry — and the headroom is what stops them
    // riding the same timeout line the export-surface family used to. The value
    // itself is left exactly where the stop-bleed put it — lowering it is a
    // separate decision, with its own measurement, and not this change's to make.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.zod.ts'],
      exclude: ['node_modules', 'dist', 'scripts'],
    },
  },
});
