// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // [#8287] Resolve `@objectstack/types` to its SOURCE. `resolveTenancyPosture`
    // reads `OS_TENANCY_POSTURE` live, and the api-key admission tests drive it
    // per-case; against a stale sibling `dist` these tests would be a verdict
    // about a build rather than about the checkout (`pnpm check:test-source-alias`).
    //
    // ANCHORED regexes, array form: a bare string `find` matches by PREFIX, so
    // with a FILE replacement it would also swallow the `/node` subpath and
    // resolve it to the garbage path `…/types/src/index.ts/node`.
    alias: [
      { find: /^@objectstack\/types$/, replacement: path.resolve(__dirname, '../types/src/index.ts') },
      { find: /^@objectstack\/types\/node$/, replacement: path.resolve(__dirname, '../types/src/node.ts') },
    ],
  },
});
