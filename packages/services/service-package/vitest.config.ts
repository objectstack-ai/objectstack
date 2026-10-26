// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// This config exists for three settings; everything else stays on vitest's
// defaults, deliberately — a key added here re-specifies behaviour for every
// test file in the package (packages/cli/vitest.config.ts's header records the
// incident that taught that).
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
    // #13517: quiet the registry's per-item registration chatter — the
    // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
    // default. Enforced by scripts/check-registry-log-declared.mjs.
    env: { OS_REGISTRY_LOG: 'warn' },
  },
  resolve: {
    // `hydration-convert-forward.test.ts` boots the REAL engine, protocol and
    // driver, so its verdict must be about the source in this checkout, never
    // a sibling's `dist/` (`pnpm check:test-source-alias`). ANCHORED regex,
    // array form: a bare string `find` matches by PREFIX and would swallow a
    // subpath into `…/src/index.ts/<sub>`.
    alias: [
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
      { find: /^@objectstack\/objectql$/, replacement: path.resolve(__dirname, '../../objectql/src/index.ts') },
      { find: /^@objectstack\/metadata-protocol$/, replacement: path.resolve(__dirname, '../../metadata-protocol/src/index.ts') },
      { find: /^@objectstack\/driver-sql$/, replacement: path.resolve(__dirname, '../../drivers/driver-sql/src/index.ts') },
      // The install-refusal pins read the boundary's status-to-code mapping
      // (`standardErrorCodeForHttpStatus`) from the source, like the rest.
      { find: /^@objectstack\/spec\/api$/, replacement: path.resolve(__dirname, '../../spec/src/api/index.ts') },
    ],
  },
});
