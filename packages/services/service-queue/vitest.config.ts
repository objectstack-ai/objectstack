// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// This config exists for exactly one setting; everything else stays on
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
    // ARRAY form with an ANCHORED `find`, deliberately. The object form matches
    // by PREFIX, so a bare key whose replacement is a FILE also swallows that
    // package's subpaths and resolves them to `.../index.ts/<subpath>` —
    // ENOTDIR at run time, in a config that reads as correct.
    // `scripts/check-test-source-alias.mjs` is the authority on the rule.
    alias: [
      // [#17612] `db-queue-adapter.ts` runs the shared `DispatchLoop` from
      // @objectstack/core, and this suite's whole subject is that loop's idle
      // cadence. Without this entry the specifier resolves through core's
      // `exports` to its `dist/`, so these verdicts would be a function of
      // another package's BUILD STATE rather than of the source in this
      // checkout — and the dangerous direction is the quiet one: an unbuilt
      // change to the loop leaves the backoff legs green against stale bytes.
      {
        find: /^@objectstack\/core$/,
        replacement: path.resolve(__dirname, '../../core/src/index.ts'),
      },
    ],
  },
});
