// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// This config exists for exactly two settings; everything else stays on
// vitest's defaults, deliberately — a key added here re-specifies behaviour
// for every test file in the package (packages/cli/vitest.config.ts's header
// records the incident that taught that).
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
  resolve: {
    alias: [
      // `redis-outage.real-redis.test.ts` boots `LiteKernel` and the cron job
      // service against a real Redis. Unaliased, the workspace links resolve
      // both to `dist/`, and the verdict becomes a function of build state.
      // `pnpm check:test-source-alias` is the gate; aliasing is its intended
      // repair. ANCHORED regexes, array form: a bare string `find` matches by
      // PREFIX and would also swallow a published subpath.
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
      { find: /^@objectstack\/service-job$/, replacement: path.resolve(__dirname, '../service-job/src/index.ts') },
    ],
  },
});
