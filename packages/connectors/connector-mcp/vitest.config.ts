// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shared preset's one setting, the registry log level, and four anchored
 * `resolve.alias` entries.
 *
 * Each entry exists so a test here judges the source in the checkout rather
 * than whatever `dist/` was last built (`scripts/check-test-source-alias.mjs`
 * named each; its registry is shrink-only, so the entries belong here, not
 * there). The package's other unaliased imports stay that registry's to retire.
 *
 *  - `@objectstack/types`: `src/mcp-provider.ts` reads `callWithBorrowedCredential`
 *    from it (ADR-0143 D4, #26702).
 *  - `@objectstack/driver-sql`, `@objectstack/objectql`, `@objectstack/platform-objects`:
 *    `mcp-include-credential-scope.test.ts` boots the credential store on a
 *    real ObjectQL over SQLite.
 *
 * Array form with ANCHORED patterns: the object form matches by prefix, so a
 * bare key whose replacement is a file also swallows every subpath.
 */

import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. The shared preset's one setting,
    // spelled here because this config replaces it.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
    // The real ObjectQL the store-backed test boots logs one registry line per
    // registered item; quiet it through the engine's own `OS_REGISTRY_LOG`
    // seam, not a change to its shipped default
    // (scripts/check-registry-log-declared.mjs).
    env: { OS_REGISTRY_LOG: 'warn' },
  },
  resolve: {
    alias: [
      { find: /^@objectstack\/types$/, replacement: path.resolve(HERE, '../../types/src/index.ts') },
      { find: /^@objectstack\/driver-sql$/, replacement: path.resolve(HERE, '../../drivers/driver-sql/src/index.ts') },
      { find: /^@objectstack\/objectql$/, replacement: path.resolve(HERE, '../../objectql/src/index.ts') },
      { find: /^@objectstack\/platform-objects$/, replacement: path.resolve(HERE, '../../platform-objects/src/index.ts') },
    ],
  },
});
