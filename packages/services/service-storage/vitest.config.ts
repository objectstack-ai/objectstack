// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    // This package had no vitest config at all, so `@objectstack/core` resolved
    // through the workspace link to `packages/core/dist/index.js` — a BUILD
    // ARTIFACT. That made the verdict of every unit pin here a function of
    // build state rather than of source, and #7668 is what that costs: all 17
    // cases of `attachment-access-hooks.test.ts` — the only executable guard on
    // the #4757 predicate-less unscoped-multi-delete refusal, which cannot be
    // expressed over REST — errored with `TypeError:
    // withoutOperationPrivateKeys is not a function` against a prebuilt tree
    // whose core dist predated that export. The source was correct the whole
    // time (`packages/core/src/security/operation-private-keys.ts`).
    //
    // The dangerous half is not the loud error. A dist that is merely BEHIND
    // rather than missing the symbol lets a pin run GREEN against core's old
    // behaviour — a passing test that is not testing the code in the checkout,
    // and nothing in the output says so.
    //
    // Turbo already orders the build correctly (`test` dependsOn `^build`), so
    // `turbo run test` was never the failing path and needed no change. Every
    // OTHER way of running this suite was: `pnpm test` inside the package,
    // `vitest run <file>`, an editor runner, or a QA agent in a tree built at
    // an older commit. Those are exactly the paths a pin gets re-run on while
    // someone is changing core — i.e. when it most needs to be telling the
    // truth. Ordering cannot fix that; removing the artifact from the path can.
    //
    // Aliasing is graph-wide, so the packages still loaded from dist (spec,
    // observability, platform-objects, objectql) resolve to this same single
    // core instance rather than a second copy — the shared tsup config
    // externalizes workspace deps, so none of them inline one.
    //
    // Array form with an anchored pattern, deliberately: the object form
    // matches by PREFIX, so a bare `@objectstack/core` entry would also swallow
    // `@objectstack/core/logger` and resolve it to `core/src/index.ts/logger`
    // (ENOTDIR). Same reasoning, and same shape, as `service-knowledge`'s
    // config.
    alias: [{ find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') }],
  },
});
