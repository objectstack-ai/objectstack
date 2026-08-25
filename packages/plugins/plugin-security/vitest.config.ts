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
      // [#11184] `bootstrap-platform-admin.ts` imports `@objectstack/types` as
      // a VALUE (`resolveTenancyPosture` / `resolvePlatformOwnerEmail`), so
      // its suites must read the producer's source in this checkout rather
      // than `dist/` — a stale dist would run GREEN against the dependency's
      // old behaviour (`check:test-source-alias` refuses exactly that).
      {
        find: /^@objectstack\/types$/,
        replacement: path.resolve(__dirname, '../../types/src/index.ts'),
      },
      // [#11843] `packaged-permission-set-lock-gate.test.ts` drives the REAL
      // `ObjectStackProtocolImplementation` (its `saveMetaItem` seam is the
      // door under test), so the protocol must be read from the producer's
      // source in this checkout — a stale `dist/` would run the pin against a
      // seam that predates `registerAuthoringGate('permission', ...)` and
      // report a verdict about the last build rather than about this tree.
      {
        find: /^@objectstack\/metadata-protocol$/,
        replacement: path.resolve(__dirname, '../../metadata-protocol/src/index.ts'),
      },
    ],
  },
});
