// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

// The shared preset's one setting, plus this package's own.
// `check-console-intercept-disarm.mjs` reads this file's source, so the
// setting is spelled here instead of merged in from `vitest.preset.mts`.
export default defineConfig({
  resolve: {
    // [ADR-0150 D8 R20, #31684] `stored-template-package-backfill.test.ts` runs
    // the backfill on a real SQL engine, so the driver is this checkout's
    // source, not a `driver-sql/dist` build (`pnpm check:test-source-alias`,
    // #7668/#7778). Anchored, array form: a bare string `find` matches by prefix.
    alias: [
      {
        find: /^@objectstack\/driver-sql$/,
        replacement: path.resolve(__dirname, '../../drivers/driver-sql/src/index.ts'),
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
    // #13517: quiet the registry's per-item registration chatter — the
    // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
    // default. Enforced by scripts/check-registry-log-declared.mjs, which
    // reads this suite as engine-booting since `template-loader.test.ts`
    // resolves email template names through a real `SchemaRegistry`
    // (ADR-0150 D3).
    env: { OS_REGISTRY_LOG: 'warn' },
  },
});
