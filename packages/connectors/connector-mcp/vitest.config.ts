// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
    // `mcp-include-credential-scope.test.ts` boots the credential store on a
    // real ObjectQL, whose registry logs one line per registered item; quiet
    // it through the engine's own `OS_REGISTRY_LOG` seam, not a change to its
    // shipped default (scripts/check-registry-log-declared.mjs).
    env: { OS_REGISTRY_LOG: 'warn' },
  },
  resolve: {
    // The store-backed test reads these three from SOURCE, so its verdict is
    // about the checkout, never about whatever `dist/` was last built
    // (`pnpm check:test-source-alias`). Anchored, array form: a bare string
    // key matches by prefix and would swallow the subpaths.
    alias: [
      { find: /^@objectstack\/driver-sql$/, replacement: path.resolve(HERE, '../../drivers/driver-sql/src/index.ts') },
      { find: /^@objectstack\/objectql$/, replacement: path.resolve(HERE, '../../objectql/src/index.ts') },
      { find: /^@objectstack\/platform-objects$/, replacement: path.resolve(HERE, '../../platform-objects/src/index.ts') },
    ],
  },
});
