// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20590 position 5 — MEASUREMENT PROBE ONLY, never a test of record.
//
// This directory sits outside `@objectstack/dogfood`'s vitest `include`
// (`test/**/*.test.ts`) and outside its tsconfig `include` (`test/**/*`), so
// neither `pnpm test` nor `pnpm typecheck` in that package ever reaches it.
// It runs only when named explicitly:
//
//   pnpm --filter @objectstack/dogfood exec vitest run \
//     --config probe-20590-p5/vitest.probe.config.mts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: __dirname,
    include: ['*.probe.ts'],
    disableConsoleIntercept: true,
    env: { OS_REGISTRY_LOG: 'warn' },
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
