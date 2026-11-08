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
      // The adapter choice reads the topology declaration and the redis
      // driver's connection offer from `@objectstack/service-cluster`, and the
      // topology tests boot the REAL redis driver over `ioredis-mock`. A unit
      // test is a verdict about the SOURCE in this checkout, so both specifiers
      // resolve to `src/` rather than to a `dist/` that may predate the edit
      // under test (`pnpm check:test-source-alias`). Both through the alias
      // also keeps ONE instance of `@objectstack/service-cluster`, which the
      // driver registers into and `defineCluster()` reads.
      //
      // ANCHORED regex, array form: a bare string `find` matches by PREFIX, so
      // a FILE replacement would also swallow the published `/testing` subpath
      // and resolve it to `…/service-cluster/src/index.ts/testing` — `ENOTDIR`
      // at run time, from a config that reads as correct.
      // The topology tests boot a real `ObjectKernel`: plugin order under
      // `optionalDependencies` is the kernel's own decision. Same reason, same
      // anchoring (core publishes `/logger` and other subpaths).
      {
        find: /^@objectstack\/core$/,
        replacement: path.resolve(__dirname, '../../core/src/index.ts'),
      },
      {
        find: /^@objectstack\/service-cluster$/,
        replacement: path.resolve(__dirname, '../service-cluster/src/index.ts'),
      },
      {
        find: /^@objectstack\/service-cluster-redis$/,
        replacement: path.resolve(__dirname, '../service-cluster-redis/src/index.ts'),
      },
    ],
  },
});
