// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The shared vitest preset. A package whose vitest config needs nothing of its
// own re-exports this file (`export { default } from '<rel>/vitest.preset.mts'`);
// one that does need something merges it (`mergeConfig(preset, { ... })`).
//
// It carries exactly one setting; everything else stays on vitest's defaults,
// deliberately — a key added here re-specifies behaviour for every test file in
// every package that re-exports it (packages/cli/vitest.config.ts's header
// records the incident that taught that).
//
// A plain object, not `defineConfig(...)` (an identity helper): this file sits
// at the repo root, whose package declares no vitest dependency, so an import
// of `vitest/config` here would resolve only through pnpm's hoisting and would
// not type-check in the root program.
export default {
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
};
