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
    alias: [
      {
        // [#17396] Both triggers read the deployment's scheduled-work switch
        // through `@objectstack/types`, and the suites assert on the exact
        // reason string that package exports. Unaliased, the workspace link
        // resolves to `dist/` and the verdict becomes a function of build state
        // rather than of the source in this checkout — a `dist` merely BEHIND
        // would run the switch pins green against a sentence no longer
        // shipping. `pnpm check:test-source-alias` is the gate.
        //
        // ANCHORED regex, array form, deliberately: a bare string `find`
        // matches by PREFIX, so with a FILE replacement it would also swallow
        // any subpath and resolve it to `…/types/src/index.ts/<sub>` —
        // `ENOTDIR` at run time, from a config that reads as correct. Same rule
        // as `packages/services/service-automation/vitest.config.ts`.
        find: /^@objectstack\/types$/,
        replacement: path.resolve(__dirname, '../../types/src/index.ts'),
      },
      {
        // [#18378] Same rule, same reason, for the record→organization
        // resolver the time-relative sweep reads per-record ownership through.
        // Unaliased this resolved `metadata-core/dist`, so the `group` pins —
        // which assert that each run is stamped from its OWN swept record —
        // were a verdict about a built artifact rather than about
        // `resolveRecordWallOrganizationField`'s precedence as it stands in this
        // checkout. That precedence (`tenancy.enabled: false` ⇒ nothing, then a
        // declared `tenancy.tenantField`, then the kernel's `organization_id` —
        // ⛔ the stamp key is NOT a limb of it) is exactly what those pins exist
        // to hold, so reading it from `dist` is the passing-test failure
        // `check:test-source-alias` was built to catch.
        //
        // ANCHORED regex for the reason the entry above states at length.
        find: /^@objectstack\/metadata-core$/,
        replacement: path.resolve(__dirname, '../../metadata-core/src/index.ts'),
      },
    ],
  },
});
