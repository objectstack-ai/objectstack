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
    // The only DOM environment in the workspace, and deliberately so (#4682):
    // these hooks are exercised through React's real renderer, so `document`
    // and friends must exist. Every other package here runs `environment:
    // 'node'` — copying that default would fail at `document is not defined`
    // before a single assertion ran.
    environment: 'jsdom',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
