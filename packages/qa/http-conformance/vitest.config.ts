// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // ARRAY form with an ANCHORED pattern, deliberately: a bare-string `find`
    // matches by PREFIX, so a key whose replacement is a FILE also swallows
    // that package's subpaths and resolves them to `…/index.ts/<subpath>` —
    // ENOTDIR at run time, in a config that reads as correct.
    // `scripts/check-test-source-alias.mjs` is the authority on the rule.
    alias: [
      // The SUBJECT of `hono-dispatcher-result-response.conformance.test.ts` is
      // `createHonoApp` itself, so its verdict has to be about this checkout's
      // adapter source and not about the last `pnpm build`. Through the
      // package `exports` this specifier resolves to `packages/adapters/hono/dist`,
      // and a stale `dist` there would leave that file green against the very
      // rendering it exists to pin. Everything else it loads —
      // `@objectstack/runtime`'s real `HttpDispatcher` above all — is
      // deliberately left resolving normally: those are the REAL boot, not the
      // subject.
      {
        find: /^@objectstack\/hono$/,
        replacement: path.resolve(__dirname, '../../adapters/hono/src/index.ts'),
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
    globals: true,
    environment: 'node',
    // The conformance suite boots real kernels + sockets.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
