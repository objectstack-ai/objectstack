// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// No `projects`: a single project leaves no narrowing for a positional filter
// to fall outside of, so vitest's own `printNoTestFound()` covers it.
import path from 'path';
import { defineConfig } from 'vitest/config';

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
  },
  resolve: {
    // Resolve `@objectstack/spec` to its SOURCE, not `dist` (`pnpm
    // check:test-source-alias`): the refusal-code catalogue a card is judged
    // against must be the one in this checkout. Anchored array form, so the
    // bare rule cannot swallow a subpath (see packages/metadata/vitest.config.ts).
    alias: [
      {
        find: /^@objectstack\/spec\/([a-z-]+)$/,
        replacement: path.join(path.resolve(__dirname, '..', '..'), 'spec/src/$1/index.ts'),
      },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(__dirname, '../../spec/src/index.ts') },
      // The scorer's three readers (`src/score/`): the stack-collection rule,
      // the standalone-action owner and the effective sharing model are judged
      // as the checkout states them, never as the last build did.
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
      { find: /^@objectstack\/objectql$/, replacement: path.resolve(__dirname, '../../objectql/src/index.ts') },
      { find: /^@objectstack\/plugin-sharing$/, replacement: path.resolve(__dirname, '../../plugins/plugin-sharing/src/index.ts') },
    ],
  },
});
