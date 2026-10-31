// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shared preset's one setting plus one anchored `resolve.alias` entry, and
 * nothing else.
 *
 * `src/rest-connector.ts` reads `callWithBorrowedCredential` from
 * `@objectstack/types` (ADR-0143 D4, #26702). Without the entry that import
 * resolves through the package's `exports` to its built `dist/`, so this
 * package's tests would judge build state rather than the source in the
 * checkout. `scripts/check-test-source-alias.mjs` named it; its registry is
 * shrink-only, so the entry belongs here, not there. The package's other
 * unaliased imports stay that registry's to retire.
 *
 * Array form with an ANCHORED pattern: the object form matches by prefix, so a
 * bare key whose replacement is a file also swallows every subpath.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // A late console.* must not redden a green suite (#10374): the shared
    // preset's one setting, spelled here because this config replaces it.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
  resolve: {
    alias: [
      {
        find: /^@objectstack\/types$/,
        replacement: path.resolve(__dirname, '../../types/src/index.ts'),
      },
    ],
  },
});
