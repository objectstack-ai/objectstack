// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    // A late console.* must not redden a green suite: vitest's worker forwards
    // console output over RPC and a write landing after teardown is rejected
    // into an unhandled error. Mechanism and measured costs:
    // examples/app-showcase/vitest.config.ts; enforced repo-wide by
    // scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
  resolve: {
    // The manual pin (`src/manual-claims-docs.test.ts`) reads this package's
    // registered docs and book through the spec's own audience resolver, so
    // both specifiers resolve to SOURCE, never to a `dist/` that may be behind
    // it (`pnpm check:test-source-alias`). Array form with anchored patterns:
    // the object form matches by prefix and would swallow sibling subpaths.
    alias: [
      {
        find: /^@objectstack\/platform-objects\/apps$/,
        replacement: path.resolve(__dirname, '../../platform-objects/src/apps/index.ts'),
      },
      {
        find: /^@objectstack\/spec\/system$/,
        replacement: path.resolve(__dirname, '../../spec/src/system/index.ts'),
      },
    ],
  },
});
