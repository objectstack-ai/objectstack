import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Every workspace package these tests import resolves to its SOURCE in this
 * checkout, so a verdict here is a verdict about the source, never about a
 * stale `dist/` (`pnpm check:test-source-alias`). Anchored, array form: a bare
 * string `find` matches by prefix and would swallow the subpaths.
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
  },
  resolve: {
    alias: [
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
      { find: /^@objectstack\/platform-objects\/apps$/, replacement: path.resolve(__dirname, '../../platform-objects/src/apps/index.ts') },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(__dirname, '../../spec/src/index.ts') },
      { find: /^@objectstack\/spec\/data$/, replacement: path.resolve(__dirname, '../../spec/src/data/index.ts') },
      { find: /^@objectstack\/spec\/security$/, replacement: path.resolve(__dirname, '../../spec/src/security/index.ts') },
    ],
  },
});
