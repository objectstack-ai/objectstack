// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // ARRAY form, not the object form: only the array form accepts a RegExp
    // `find`, and the `@objectstack/platform-objects` entries below have to be
    // anchored (see their note). The pre-existing string entries keep the
    // prefix-match semantics they had as object keys — Vite normalizes an alias
    // object into exactly this list, in this order, first match wins — so this
    // conversion changes no resolution, it only makes room for a regex.
    alias: [
      // Subpath before the bare package: a string `find` prefix-replaces, so
      // without this entry `@objectstack/core/logger` (imported by the built
      // client, see route-ledger.conformance.test.ts) resolves to the garbage
      // path `…/core/src/index.ts/logger`.
      { find: '@objectstack/core/logger', replacement: path.resolve(__dirname, '../core/src/logger.ts') },
      { find: '@objectstack/core', replacement: path.resolve(__dirname, '../core/src/index.ts') },
      // #7828 / PR #8128: action-execution-destructive.test.ts reads the REAL
      // `sys_*` identity declarations to prove that today's platform objects
      // are excluded before `actionLooksDestructive` ever runs on them. That
      // import resolved through `exports` to `platform-objects/dist` — a build
      // artifact — so all 66 pins were a verdict about build state rather than
      // about the declarations in the checkout (`pnpm check:test-source-alias`,
      // #7668/#7778).
      //
      // ANCHORED regexes, array form, deliberately — the same correction
      // `@objectstack/spec` gets in packages/qa/downstream-contract (PR #8129).
      // A bare `@objectstack/platform-objects` string entry matches by PREFIX,
      // so with a FILE replacement it also swallows the `/identity` subpath and
      // resolves it to `…/platform-objects/src/index.ts/identity` — `ENOTDIR`,
      // at run time, from a config that reads as correct.
      //
      // One rule for every namespace rather than an enumeration of the ones
      // reached today, so it cannot go stale as tests reach new subpaths.
      // `/plugin` is listed ahead of it because it is the one exported subpath
      // that is a FILE (`src/plugin.ts`) and not a namespace directory: the
      // namespace rule would send it to `src/plugin/index.ts`, which does not
      // exist — and which `check:test-source-alias` cannot catch, since that
      // path still reads as pointing at source.
      {
        find: /^@objectstack\/platform-objects\/plugin$/,
        replacement: path.resolve(__dirname, '../platform-objects/src/plugin.ts'),
      },
      {
        find: /^@objectstack\/platform-objects\/([a-z-]+)$/,
        replacement: path.join(path.resolve(__dirname, '..'), 'platform-objects/src/$1/index.ts'),
      },
      {
        find: /^@objectstack\/platform-objects$/,
        replacement: path.resolve(__dirname, '../platform-objects/src/index.ts'),
      },
      { find: '@objectstack/rest', replacement: path.resolve(__dirname, '../rest/src/index.ts') },
      // #9457: ONE anchored rule for every `@objectstack/spec` namespace, in
      // place of the hand-maintained list of the twelve subpaths tests happened
      // to reach on the day it was written. That list had gone stale in three
      // places — `cloud`, `integration` and `studio` are published subpath
      // exports with no entry — and a bare string `find` matches by PREFIX with
      // a FILE replacement, so `@objectstack/spec/cloud` resolved to the
      // garbage path `…/spec/src/index.ts/cloud` and died with `ENOTDIR` inside
      // whichever module happened to import it. Measured before this change:
      // `MetadataPlugin._parseAndRegisterArtifact` (`await
      // import('@objectstack/spec/cloud')`) took every artifact-loading test in
      // this package down with an error naming the metadata plugin rather than
      // this table — the diagnostic distance is the real defect, the missing
      // subpath is only its trigger.
      //
      // `@objectstack/spec`'s export map is UNIFORM: every published namespace
      // is `src/<ns>/index.ts`, and it has no FILE-shaped subpath of the kind
      // `@objectstack/platform-objects/plugin` is (which is exactly why the
      // rule above it needs a hand-written entry and this one does not). So one
      // rule covers all fifteen and cannot go stale as tests reach new
      // namespaces — the same shape `packages/qa/downstream-contract` (PR
      // #8129), `service-knowledge`, `service-settings` and `plugin-audit`
      // already carry.
      //
      // What the enumeration recorded, kept because the reasons outlive it:
      // `automation` carries the declared effect `AppPlugin` reads off a bundle
      // function (#4396); `identity` is reached through
      // `@objectstack/platform-objects` (`sys-user.object.ts`) by
      // notifications.hono.integration.test.ts; `security` is reached
      // transitively via `@objectstack/types` ([ADR-0105 D1] tenancy posture).
      // None of the three is a reason to keep listing namespaces by hand.
      //
      // `src/spec-subpath-alias-coverage.pin.test.ts` pins the RULE rather than
      // any one subpath: it derives the population from spec's published
      // `exports` map, so a subpath this rule stops covering fails there.
      {
        find: /^@objectstack\/spec\/([a-z-]+)$/,
        replacement: path.join(path.resolve(__dirname, '..'), 'spec/src/$1/index.ts'),
      },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(__dirname, '../spec/src/index.ts') },
      // Subpath BEFORE the bare package, same prefix-match reason: `./node` is a
      // published subpath served by a FILE (`types/src/node.ts` — the node-only slice
      // the root export deliberately excludes), so the bare entry would resolve it to
      // `…/types/src/index.ts/node`. Same published-subpath rule pins it.
      { find: /^@objectstack\/types\/node$/, replacement: path.resolve(__dirname, '../types/src/node.ts') },
      { find: '@objectstack/types', replacement: path.resolve(__dirname, '../types/src/index.ts') },
      // Dev-only: app-plugin.jobs.test.ts drives the REAL CronJobAdapter, so
      // the #4567 regression (croner rejecting the expression envelope) is
      // reproduced by the actual scheduler rather than by a double.
      { find: '@objectstack/service-job', replacement: path.resolve(__dirname, '../services/service-job/src/index.ts') },
      // Dev-only: app-plugin.disabled-seed.test.ts drives the REAL
      // `sys_packages` → registry rehydration (#5047), so the empty-env seed
      // regression is proven against the actual hydration code rather than a
      // re-implementation of it.
      {
        find: '@objectstack/service-package',
        replacement: path.resolve(__dirname, '../services/service-package/src/index.ts'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
