// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // [#8570] `record-lock-batch-row-status.integration.test.ts` drives the
    // REAL lock hook through the REAL bulk-write loops, so it imports
    // `@objectstack/metadata-protocol` as a value. That specifier resolves
    // through `exports` to `dist/` — a build artifact — which would make the
    // pin a verdict about build state rather than about the source in the
    // checkout (`pnpm check:test-source-alias`, #7668/#7778). Aliased to
    // source, which is that gate's prescribed fix; registering the package as
    // an unaliased importer is explicitly NOT (the registry is shrink-only).
    //
    // ANCHORED regex, array form: a bare string `find` matches by PREFIX, so
    // with a FILE replacement it would also swallow any subpath and resolve it
    // to `…/metadata-protocol/src/index.ts/<subpath>` — `ENOTDIR`, at run
    // time, from a config that reads as correct.
    alias: [
      {
        find: /^@objectstack\/metadata-protocol$/,
        replacement: path.resolve(__dirname, '../../metadata-protocol/src/index.ts'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
