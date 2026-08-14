// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    // [#8577] Both entries exist for `suggested-audience-bindings-install-path.test.ts`,
    // the one suite here that imports sibling packages as VALUES: it drives the real
    // `syncAudienceBindingSuggestions` against a real `ObjectQL` engine over a real
    // `SqlDriver`, because the question it answers — does the SECOND organization to
    // install a package get its own binding-suggestion row? — cannot be asked of a
    // fake engine at all.
    //
    // Unaliased, those two specifiers resolve through the workspace link to `dist/` —
    // a BUILD ARTIFACT — which would make this suite's verdict a function of build
    // state rather than of the source in the checkout. The loud failure (missing
    // export) is the mild half; a dist merely BEHIND runs GREEN against the
    // dependency's old behaviour and says nothing. That is the exact hazard here:
    // this suite's subject is the interaction between a DECLARED index's scope and
    // the driver that materializes it, so a stale `driver-sql` would report the
    // pre-fix installation-wide index as per-organization — the #8577 defect itself,
    // passing.
    //
    // Turbo already orders `test` after `^build`, so `turbo run test` was never the
    // failing path. The paths it does not mediate are: `pnpm test` inside this
    // package, `vitest run <file>`, an editor runner, or an agent working in a tree
    // built at an older commit — precisely the ways this pin gets re-run WHILE
    // someone is changing the index scope or the drift arm.
    //
    // Array form with anchored patterns, deliberately: the object form matches by
    // PREFIX, so a bare key with a FILE replacement would also swallow any subpath
    // import and resolve it to `…/src/index.ts/<subpath>` (ENOTDIR) at run time, in
    // a config that looks right.
    alias: [
      {
        find: /^@objectstack\/driver-sql$/,
        replacement: path.resolve(__dirname, '../../drivers/driver-sql/src/index.ts'),
      },
      {
        find: /^@objectstack\/objectql$/,
        replacement: path.resolve(__dirname, '../../objectql/src/index.ts'),
      },
    ],
  },
});
