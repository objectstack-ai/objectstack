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
 * unchanged: `@objectstack/driver-sql`, `@objectstack/objectql`,
 * `@objectstack/service-automation` are untouched by this file and remain that
 * registry's problem to eventually retire; `@objectstack/core` has since been
 * aliased below and taken off that entry).
 */
export default defineConfig({
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
    globals: true,
    environment: 'node',
  },
  resolve: {
    // Anchored array form: the object form matches by PREFIX, so a bare
    // `@objectstack/spec` key would swallow every subpath (the ENOTDIR trap
    // `check-test-source-alias` names). `@objectstack/spec/data` is imported
    // for a VALUE (`SECRET_MASK`) by `trigger-record-credential-mask.test.ts`.
    alias: [
      { find: /^@objectstack\/formula$/, replacement: path.resolve(__dirname, '../../formula/src/index.ts') },
      { find: /^@objectstack\/spec\/data$/, replacement: path.resolve(__dirname, '../../spec/src/data/index.ts') },
      // `@objectstack/core` carries `omitInternalFieldsFromWriteResponse`, the
      // ADR-0100 mask helper `record-change-trigger.ts` applies, so the mask
      // pins read it from source rather than from core's `dist/`.
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
    ],
  },
});
