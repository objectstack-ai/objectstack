// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
  resolve: {
    // One entry, for `@objectstack/lint`, keyed on the SPECIFIER — so it
    // governs every suite in this package that imports that package as a
    // VALUE, not one named suite. `managed-api-method-affordance-sweep.test.ts`
    // (#7934) is the suite that first needed it — it calls
    // `validateManagedApiMethods` over every code-shipped managed object in
    // the checkout — but deleting or rewriting THAT suite does not free this
    // entry, and a count of the suites written here goes stale silently: this
    // comment carried one ("the only suite") that was already wrong.
    //
    // The dependent set is whatever
    // `git grep "from '@objectstack/lint'" -- packages/platform-objects/src`
    // returns, and `pnpm check:test-source-alias` is what decides whether the
    // entry may go at all: it recomputes the workspace packages this package's
    // tests import as VALUES, keeps the ones whose entry point resolves under
    // `dist/`, replays this file's alias entries the way Vite does, and reddens
    // on anything left unaliased and unregistered. Remove the entry and it is
    // that gate, not a reading of one test file, that answers.
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
  // Discovery is untouched — but this file is NOT "the alias and nothing else".
  // The `test` block above carries exactly one key, and it is a run-exit fix
  // (`disableConsoleIntercept`, #10374), not a discovery key: no `include`,
  // `exclude` or `dir` is set anywhere here, so this package's suite is still
  // discovered on vitest's defaults, as it was before this file existed.
  //
  // Narrowing `include` here would silently drop cases while the gate this file
  // answers went green: the sweep's population floors (76 object files / 51
  // in-scope / 9 packages) are measured by walking the filesystem, but the rest
  // of the package's suite is discovered by vitest.
  //
  // The two claims this paragraph replaces — that a `test` block was absent
  // here, and that the alias was this file's sole effect — were true as written
  // (#7934/#8314), and were falsified in place when the disarm landed ABOVE them
  // and left them standing (#10374/#13522): the same silent staleness the alias
  // rationale above records against its own suite count. Deleting or rewriting
  // this config now costs the disarm as well as the alias (#16189). Paraphrased
  // rather than quoted, so a census grep for the retired wording does not land
  // back on this file.
});
