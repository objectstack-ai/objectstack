// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The `test:` block here carries exactly one setting; everything else stays on
// vitest's defaults, deliberately — a key added there re-specifies behaviour
// for every test file in the package (packages/cli/vitest.config.ts's header
// records the incident that taught that). `resolve.alias` below is not such a
// key: it changes which BYTES a specifier resolves to, not how any test runs.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // [#16291] `report-service.ts` imports `isValueDomainMember` from
    // `@objectstack/spec/shared` as a VALUE (the type-only imports beside it are
    // erased and never resolve at run time, which is why this package needed no
    // alias table until now). Unaliased, a value specifier resolves through the
    // workspace link to `@objectstack/spec`'s `dist/` — a BUILD ARTIFACT — so the
    // timezone tests below would be a verdict about build state rather than about
    // the predicate in this checkout, and a dist merely BEHIND would let them pass
    // against the old membership answer with nothing in the output saying so
    // (`pnpm check:test-source-alias`).
    //
    // ONE anchored rule for every published `@objectstack/spec` namespace rather
    // than an entry for the one subpath reached today: spec's export map is
    // UNIFORM (every namespace is `src/<ns>/index.ts`, with no FILE-shaped
    // subpath), so the rule cannot go stale as tests reach new namespaces. Same
    // shape as packages/metadata, packages/runtime and packages/qa/downstream-contract.
    //
    // ⛔ Array form with ANCHORED patterns, never the object form: object keys
    // match by PREFIX, so a bare `@objectstack/spec` key with a FILE replacement
    // swallows `@objectstack/spec/shared` and resolves it to
    // `…/spec/src/index.ts/shared` — ENOTDIR at run time, from a config that
    // reads as correct.
    alias: [
      {
        find: /^@objectstack\/spec\/([a-z-]+)$/,
        replacement: path.join(path.resolve(__dirname, '../..'), 'spec/src/$1/index.ts'),
      },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(__dirname, '../../spec/src/index.ts') },
    ],
  },
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
});
