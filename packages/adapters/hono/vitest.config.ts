// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    // ARRAY form, deliberately. The object form matches by PREFIX, so a bare
    // key whose replacement is a FILE also swallows that package's subpaths and
    // resolves them to `…/index.ts/<subpath>` — ENOTDIR at run time, in a
    // config that reads as correct. An anchored regex `find` cannot do that.
    // `scripts/check-test-source-alias.mjs` is the authority on the rule.
    alias: [
      // `src/index.ts` imports createOriginMatcher, hasWildcardPattern,
      // DEFAULT_CORS_ALLOW_HEADERS and DEFAULT_CORS_EXPOSE_HEADERS from
      // @objectstack/plugin-hono-server as VALUES, at module scope. Without
      // this entry the specifier resolves through that package's `exports` to
      // its `dist/`, and this suite's verdicts become a function of another
      // package's build state: measured on this branch, gutting
      // `createOriginMatcher` in plugin-hono-server's SOURCE with no rebuild
      // left all 74 cases green — including the five CORS wildcard cases whose
      // whole subject that function is.
      {
        find: /^@objectstack\/plugin-hono-server$/,
        replacement: path.resolve(__dirname, '../../plugins/plugin-hono-server/src/index.ts'),
      },
      // Unchanged in reach from the object entry this array replaced: a bare
      // string `find` still matches by prefix, so the kernel mock keeps exactly
      // the surface it had. @objectstack/runtime publishes only `.`, so there
      // is no subpath here for the prefix to swallow.
      {
        find: '@objectstack/runtime',
        replacement: path.resolve(__dirname, 'src/__mocks__/runtime.ts'),
      },
    ],
  },
});
