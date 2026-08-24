// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // One entry, for `canonical-expression-envelopes.test.ts` (#11480) — the
    // only suite here that imports `@objectstack/lint` as a VALUE. It runs the
    // shared canonical-envelope detector (`auditPageExpressionEnvelopes`) over
    // this package's own `Page` exports.
    //
    // Unaliased, that specifier resolves through `exports` to `lint/dist` — a
    // BUILD ARTIFACT — which would make the gate a verdict about build state
    // rather than about the source next to it (`pnpm check:test-source-alias`,
    // #7668/#7778). The loud failure (missing export) is the mild half; a dist
    // merely BEHIND lets the gate run GREEN against the detector's old
    // behaviour with nothing in the output saying so — and this suite's whole
    // purpose is to run the CURRENT detector over the CURRENT pages.
    //
    // Array form with an anchored pattern, deliberately, and here that is
    // load-bearing rather than stylistic: `@objectstack/lint` exports a second
    // subpath (`./runtime`), and the object form matches by PREFIX, so a bare
    // `@objectstack/lint` key with a FILE replacement would also swallow
    // `@objectstack/lint/runtime` and resolve it to `…/lint/src/index.ts/runtime`
    // — `ENOTDIR`, at run time, in a config that reads as correct. Same shape
    // as `packages/platform-objects`'s config (the reference consumer of this
    // detector), `packages/rest`'s (#7955) and `service-storage`'s (#7778).
    alias: [
      {
        find: /^@objectstack\/lint$/,
        replacement: path.resolve(__dirname, '../lint/src/index.ts'),
      },
    ],
  },
  // No `test` block: this package had no vitest config until now, so its suite
  // ran on vitest's defaults. Leaving discovery untouched keeps this file's
  // only effect the alias above — narrowing `include` here would silently drop
  // the rest of the package's suite while this gate stayed green.
});
