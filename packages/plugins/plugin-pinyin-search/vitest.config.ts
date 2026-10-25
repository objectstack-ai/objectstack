// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// Everything not set here stays on vitest's defaults, deliberately — a key
// added here re-specifies behaviour for every test file in the package
// (packages/cli/vitest.config.ts's header records the incident that taught
// that).
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // [#25634] `boot-reconcile.integration.test.ts` boots the REAL kernel over
    // the REAL SQLite driver with the REAL `sys_migration` object, so those
    // specifiers resolve to source, not to a `dist/` build
    // (`pnpm check:test-source-alias`, #7668/#7778). Anchored regexes: a bare
    // string `find` matches by prefix and would swallow subpaths.
    alias: [
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
      { find: /^@objectstack\/driver-sql$/, replacement: path.resolve(__dirname, '../../drivers/driver-sql/src/index.ts') },
      // `boot-reconcile.ts` reads the ledger's row contract from spec.
      { find: /^@objectstack\/spec\/system$/, replacement: path.resolve(__dirname, '../../spec/src/system/index.ts') },
      {
        find: /^@objectstack\/platform-objects\/system$/,
        replacement: path.resolve(__dirname, '../../platform-objects/src/system/index.ts'),
      },
    ],
  },
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
});
