// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // One entry, for `managed-api-method-affordance-sweep.test.ts` (#7934) —
    // the only suite here that imports a sibling package as a VALUE. It calls
    // `validateManagedApiMethods` from `@objectstack/lint` over every
    // code-shipped managed object in the checkout.
    //
    // Unaliased, that specifier resolves through `exports` to `lint/dist` — a
    // BUILD ARTIFACT — which would make this sweep a verdict about build state
    // rather than about the source next to it (`pnpm check:test-source-alias`,
    // #7668/#7778). The loud failure (missing export) is the mild half; a dist
    // merely BEHIND lets the sweep run GREEN against the rule's old behaviour
    // with nothing in the output saying so. That is acutely wrong for THIS
    // suite: its entire purpose is to run the CURRENT rule over the CURRENT
    // objects, so a stale rule silently narrows the very population it exists
    // to judge, and the sweep keeps reporting zero findings while it does.
    //
    // Turbo already orders `test` after `^build`, so `turbo run test` was never
    // the failing path. The paths it does not mediate are `pnpm test` inside
    // this package, `vitest run <file>`, an editor runner, or an agent working
    // in a tree built at an older commit — precisely the ways this sweep gets
    // re-run WHILE someone is changing the affordance rule.
    //
    // Array form with an anchored pattern, deliberately, and here that is
    // load-bearing rather than stylistic: `@objectstack/lint` exports a second
    // subpath (`./runtime`), and the object form matches by PREFIX, so a bare
    // `@objectstack/lint` key with a FILE replacement would also swallow
    // `@objectstack/lint/runtime` and resolve it to `…/lint/src/index.ts/runtime`
    // — `ENOTDIR`, at run time, in a config that reads as correct. Same shape as
    // `packages/rest`'s config (#7955) and `service-storage`'s (#7778).
    alias: [
      {
        find: /^@objectstack\/lint$/,
        replacement: path.resolve(__dirname, '../lint/src/index.ts'),
      },
    ],
  },
  // No `test` block: this package had no vitest config until now, so its suite
  // ran on vitest's defaults. Leaving discovery untouched keeps this file's only
  // effect the alias above — the sweep's population floors (76 object files / 51
  // in-scope / 9 packages) are measured by walking the filesystem, but the rest
  // of the package's suite is discovered by vitest, and narrowing `include` here
  // would silently drop cases while the gate this file answers went green.
});
