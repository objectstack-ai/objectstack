// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ⛔ This config declares NO `projects`, and that is the reason it needs no
// preflight of its own: with a single project there is no narrowing for a
// positional filter to fall outside of, so vitest's already-loud
// `printNoTestFound()` covers every way a filter here can select nothing.
// `test/config-wiring-sweep.test.ts` derives that same condition from
// `pnpm-workspace.yaml` rather than from a list, so this package is exempt by
// measurement rather than by being written down.
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
  },
});
