// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // `action-predicate-sparse-face.test.ts` (#8990) drives this app's row
    // action predicate through the CEL engine itself, because the whole point
    // of that pin is what the ENGINE answers on a sparse list row — a fault
    // versus a considered `false`, which are the same pixel to the user.
    // Unaliased, `@objectstack/formula` resolves through the workspace link to
    // `dist/` — a build artifact — so the verdict would be a function of build
    // state rather than of the source in this checkout. The loud half (a
    // missing export) is the mild one; a dist merely BEHIND runs the suite
    // GREEN against the engine's OLD null/absence semantics, which is exactly
    // the behaviour these assertions exist to pin. `pnpm check:test-source-alias`
    // is the gate.
    //
    // ANCHORED regex, array form, deliberately: a bare string `find` matches by
    // PREFIX, so with a FILE replacement it would also swallow any subpath and
    // resolve it to `…/formula/src/index.ts/<sub>` — `ENOTDIR` at run time,
    // from a config that reads as correct.
    alias: [
      { find: /^@objectstack\/formula$/, replacement: path.resolve(__dirname, '../../packages/formula/src/index.ts') },
    ],
  },
});
