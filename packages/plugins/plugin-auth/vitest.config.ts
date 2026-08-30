// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
    environment: 'node',
    testTimeout: 10_000,
    alias: [
      // The human-user predicate agreement pin drives plugin-security's
      // `bootstrapPlatformAdmin` to read its hand-spelled `isHumanUser`. A pin
      // is a verdict about the SOURCE in this checkout, so the specifier
      // resolves to `src/` rather than to a `dist/` that may predate the edit
      // under test. Anchored (`^…$`, array form) so the entry cannot swallow
      // subpath specifiers.
      {
        find: /^@objectstack\/plugin-security$/,
        replacement: path.resolve(here, '../plugin-security/src/index.ts'),
      },
    ],
  },
});
