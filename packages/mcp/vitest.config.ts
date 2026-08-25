// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    // #8651 pinned this package's three engine doubles to the producer-side
    // dispatch predicates, which meant taking `@objectstack/metadata-core` as a
    // devDependency — this package previously depended on neither home of the
    // predicate. That import is a VALUE import, and `@objectstack/metadata-core`
    // resolves through its `exports` to `dist/`, so without this alias the pins
    // would be judging metadata-core's BUILD ARTIFACT rather than the source in
    // the checkout.
    //
    // The dangerous half is not a loud error. `assertEngineDeleteDispatch` /
    // `assertEngineUpdateDispatch` ARE the contract these doubles are pinned to;
    // a dist merely BEHIND rather than missing them lets every pin here run
    // GREEN against the predicate's old behaviour, with nothing in the output
    // saying so — a gate reporting on the wrong tree, which is the exact shape
    // check-engine-double-contract exists to prevent one layer down.
    //
    // Turbo already orders `test` after `^build`, so `turbo run test` was never
    // the exposed path. The exposed ones are `pnpm test` inside this package,
    // `vitest run <file>`, an editor runner, or an agent in a tree built at an
    // older commit.
    //
    // Array form with an anchored pattern, deliberately: the OBJECT form matches
    // by prefix, so a bare `@objectstack/metadata-core` key would also swallow
    // any subpath and resolve it to `…/src/index.ts/<subpath>` (ENOTDIR) — a
    // config that looks right and fails at run time. Same shape as
    // `plugin-sharing`'s.
    //
    // The second entry is for `canonical-expression-envelopes.test.ts` (#12269)
    // — the only suite here that imports `@objectstack/lint` as a VALUE. It
    // runs the shared canonical-envelope detector
    // (`auditPageExpressionEnvelopes`) over this package's own `Page` export.
    // Unaliased, that specifier resolves through `exports` to `lint/dist`, and
    // the failure mode is the same silent one the note above describes: a dist
    // merely BEHIND lets this gate run GREEN against the detector's old
    // behaviour, while the gate's whole purpose is to run the CURRENT detector
    // over the CURRENT page. Anchored for a second reason here — `@objectstack/lint`
    // exports a `./runtime` subpath, and the object form would swallow it and
    // resolve it to `…/lint/src/index.ts/runtime` (ENOTDIR) at run time.
    alias: [
      { find: /^@objectstack\/metadata-core$/, replacement: path.resolve(__dirname, '../metadata-core/src/index.ts') },
      { find: /^@objectstack\/lint$/, replacement: path.resolve(__dirname, '../lint/src/index.ts') },
    ],
  },
});
