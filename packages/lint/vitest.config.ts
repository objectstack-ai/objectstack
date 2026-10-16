// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// This config exists for exactly two settings; everything else stays on
// vitest's defaults, deliberately — a key added here re-specifies behaviour
// for every test file in the package (packages/cli/vitest.config.ts's header
// records the incident that taught that). Both settings are package-wide on
// purpose: each removes a mechanism every file here is exposed to, rather
// than tuning one file.
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
    server: {
      deps: {
        // Load the linked `@objectstack/spec` dist with Node, not through
        // vite's transform. Vitest's default `external` is node_modules-only,
        // judged on a module's REALPATH, and a pnpm-linked workspace package's
        // realpath is `packages/spec/dist/…` — so without this nearly every
        // file here (lint imports spec's root and nine subpaths) inlined about
        // 33 MB of built `.mjs`, and the first file to import a lint entry paid
        // ~10 s of its cold transform. The import resolves through `exports`
        // to `dist/` either way, so this changes only who evaluates that dist,
        // never which bytes are under test.
        //
        // ⚠️ The pattern must match the realpath; a name-shaped one
        // (`@objectstack/spec`) matches nothing, silently — see
        // packages/cli/vitest.config.ts. The positive control is
        // `src/vitest-spec-external.test.ts`, red the moment this stops
        // matching.
        //
        // Cost: an externalised module cannot be `vi.mock`ed. The census taken
        // when this landed found zero `vi.mock` / `vi.doMock` / `vi.hoisted`
        // sites in this package; a later test that needs to mock spec must
        // move this entry, not work around it.
        external: [/[\\/]packages[\\/]spec[\\/]dist[\\/]/],
      },
    },
  },
});
