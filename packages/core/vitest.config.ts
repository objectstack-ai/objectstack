// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    // [#11663 L2] `security/platform-admin.ts` imports `@objectstack/types` as
    // a VALUE — `resolvePlatformOwnerEmail` (the live env read) and
    // `isEmailVerifiedUserRow` (the fail-closed verified allow-list) — so the
    // suites over it must read the producer's SOURCE in this checkout rather
    // than the workspace link's `dist/`. The loud failure (a missing export) is
    // the mild half; a `dist/` merely BEHIND runs GREEN against the
    // dependency's old behaviour and says nothing at all — and the behaviour in
    // question here is which stored `email_verified` representations count as
    // verified, i.e. exactly the predicate that decides who is a superuser.
    // `check:test-source-alias` refuses precisely that shape.
    //
    // Array form with an anchored pattern, deliberately: the object form
    // matches by PREFIX, so a bare key with a FILE replacement would also
    // swallow any subpath import and resolve it to `…/src/index.ts/<subpath>`
    // (ENOTDIR) at run time, in a config that looks right.
    alias: [
      {
        find: /^@objectstack\/types$/,
        replacement: path.resolve(__dirname, '../types/src/index.ts'),
      },
    ],
  },
});
