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
      {
        // [#19995] `objectql-read-scope-refusal-envelope.test.ts` runs the
        // strategy against a REAL `ObjectQL` engine, because the refusal it
        // pins is the engine's own. Unaliased, the workspace link resolves the
        // engine to `dist/`, and the verdict becomes a function of build state:
        // a `dist` merely BEHIND would answer with the engine's old comparand
        // doors. `pnpm check:test-source-alias` is the gate; aliasing is its
        // intended repair (never a wider ledger entry).
        //
        // ANCHORED regex, array form: a bare string `find` matches by PREFIX,
        // so a FILE replacement would also swallow the published `/core`
        // subpath and resolve it to `…/objectql/src/index.ts/core` — `ENOTDIR`
        // at run time, from a config that reads as correct.
        find: /^@objectstack\/objectql$/,
        replacement: path.resolve(__dirname, '../../objectql/src/index.ts'),
      },
    ],
  },
});
