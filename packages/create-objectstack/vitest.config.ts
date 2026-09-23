import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The scaffolder's tests pin their output against the spec's own exported
  // rule (`MANIFEST_ID_PATTERN`). Resolved through `dist/`, that verdict would
  // be a function of build state rather than of the source in this checkout —
  // and the dangerous direction is silent, because a stale `dist` runs GREEN.
  // Anchored per subpath: the object form matches by PREFIX and would resolve
  // `@objectstack/spec/kernel` to `…/src/index.ts/kernel`
  // (`pnpm check:test-source-alias`).
  resolve: {
    alias: [
      {
        find: /^@objectstack\/spec\/kernel$/,
        replacement: path.resolve(HERE, '../spec/src/kernel/index.ts'),
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
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
