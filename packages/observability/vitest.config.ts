// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

// The shared preset's one setting, plus this package's own.
// `check-console-intercept-disarm.mjs` reads this file's source, so the
// setting is spelled here instead of merged in from `vitest.preset.mts`.
export default defineConfig({
  resolve: {
    // `__tests__/loggers.test.ts` pins the loggers' cause-chain copy to
    // `faultCauseChain`, so `@objectstack/types` is this checkout's source,
    // not a `types/dist` build that may be behind it
    // (`pnpm check:test-source-alias`). A devDependency only: the package's
    // runtime edge is `@objectstack/spec` alone. Anchored, array form: a bare
    // string `find` matches by prefix.
    alias: [
      {
        find: /^@objectstack\/types$/,
        replacement: path.resolve(__dirname, '../types/src/index.ts'),
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
