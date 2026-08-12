// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    // Both entries exist for `remote-tables-twin.equivalence.test.ts` (#7955),
    // the one suite here that imports sibling packages as VALUES: it mounts the
    // `service-datasource` admin registrar next to this package's federation
    // registrar to pin that the two `listRemoteTables` spellings answer `?schema=`
    // identically, and drives both through the real Hono adapter.
    //
    // Unaliased, those two specifiers resolve through the workspace link to
    // `dist/` — a BUILD ARTIFACT — which makes this suite's verdict a function of
    // build state rather than of the source in the checkout. The loud failure
    // (missing export) is the mild half; a dist merely BEHIND lets the test run
    // GREEN against the dependency's old behaviour, and nothing in the output
    // says so. That is exactly the hazard for a CROSS-PACKAGE equivalence pin:
    // its whole job is to notice when one of the two twins moves, and a stale
    // `service-datasource` dist would report the pre-fix admin route as agreeing
    // with the federation one — the #7955 defect itself, passing.
    //
    // Turbo already orders `test` after `^build`, so `turbo run test` was never
    // the failing path. The paths it does not mediate are: `pnpm test` inside
    // this package, `vitest run <file>`, an editor runner, or an agent working
    // in a tree built at an older commit — which are precisely the ways this pin
    // gets re-run WHILE someone is changing one of the two routes.
    //
    // Array form with anchored patterns, deliberately: the object form matches
    // by PREFIX, so a bare `@objectstack/service-datasource` key with a FILE
    // replacement would also swallow `@objectstack/service-datasource/contracts`
    // and resolve it to `…/src/index.ts/contracts` (ENOTDIR) at run time, in a
    // config that looks right. Same shape as `service-storage`'s config (#7778).
    alias: [
      {
        find: /^@objectstack\/plugin-hono-server$/,
        replacement: path.resolve(__dirname, '../plugins/plugin-hono-server/src/index.ts'),
      },
      {
        find: /^@objectstack\/service-datasource$/,
        replacement: path.resolve(__dirname, '../services/service-datasource/src/index.ts'),
      },
    ],
  },
});
