// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
    environment: 'node',
    env: { OS_REGISTRY_LOG: 'warn' },
  },
  resolve: {
    // The tests are a verdict about the source in the checkout, never a sibling's build
    // (scripts/check-test-source-alias.mjs). Each spec namespace is `src/<ns>/index.ts`.
    alias: [
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
      { find: /^@objectstack\/objectql$/, replacement: path.resolve(__dirname, '../../objectql/src/index.ts') },
      {
        find: /^@objectstack\/spec\/([a-z-]+)$/,
        replacement: `${path.resolve(__dirname, '../../spec/src')}/$1/index.ts`,
      },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(__dirname, '../../spec/src/index.ts') },
      { find: /^@objectstack\/types$/, replacement: path.resolve(__dirname, '../../types/src/index.ts') },
    ],
  },
});
