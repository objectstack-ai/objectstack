// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

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
    // Array form with anchored patterns, deliberately. The object form matches
    // by PREFIX, so the bare `@objectstack/spec` entry swallowed every subpath
    // that was not spelled out above it — `@objectstack/spec/ui` resolved to
    // `spec/src/index.ts/ui` and failed with `ENOTDIR`. That made the list of
    // namespaces something every new import had to extend by hand, and the
    // failure landed on whoever added the import, naming a path nobody wrote.
    // One rule for all namespaces cannot go stale that way.
    alias: [
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
      {
        find: /^@objectstack\/spec\/([a-z-]+)$/,
        replacement: `${path.resolve(__dirname, '../../spec/src')}/$1/index.ts`,
      },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(__dirname, '../../spec/src/index.ts') },
    ],
  },
});
