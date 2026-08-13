// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * `check:test-source-alias` (#7668/#7778/#7849) — a unit test must be a
 * verdict about the SOURCE in the checkout, not a sibling package's build
 * artifact. This package had no config at all until #4953 (services half)
 * added a `@objectstack/formula` devDependency for
 * `record-change-trigger.test.ts` (CEL-evaluating the seeded record through
 * the SAME engine the automation service and rule-validator use, to prove
 * the materialization fix without a stand-in). That import resolves through
 * `exports` to `dist/` with no config, so it is aliased to source here —
 * exactly the fix that gate's own header prescribes, not a widening of its
 * `KNOWN_UNALIASED_TEST_IMPORTS` registry entry for this package (which stays
 * unchanged: `@objectstack/core`, `@objectstack/driver-sql`,
 * `@objectstack/objectql`, `@objectstack/service-automation` are untouched by
 * this file and remain that registry's problem to eventually retire).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@objectstack/formula': path.resolve(__dirname, '../../formula/src/index.ts'),
    },
  },
});
