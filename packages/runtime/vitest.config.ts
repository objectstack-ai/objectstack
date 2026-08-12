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
      { find: '@objectstack/spec/ai', replacement: path.resolve(__dirname, '../spec/src/ai/index.ts') },
      { find: '@objectstack/spec/api', replacement: path.resolve(__dirname, '../spec/src/api/index.ts') },
      // `AppPlugin` reads a bundle function's declared effect off this
      // namespace (#4396).
      { find: '@objectstack/spec/automation', replacement: path.resolve(__dirname, '../spec/src/automation/index.ts') },
      { find: '@objectstack/spec/contracts', replacement: path.resolve(__dirname, '../spec/src/contracts/index.ts') },
      { find: '@objectstack/spec/data', replacement: path.resolve(__dirname, '../spec/src/data/index.ts') },
      // Reached via `@objectstack/platform-objects` (sys-user.object.ts), which
      // notifications.hono.integration.test.ts pulls in for the real
      // `sys_notification` declaration.
      { find: '@objectstack/spec/identity', replacement: path.resolve(__dirname, '../spec/src/identity/index.ts') },
      { find: '@objectstack/spec/kernel', replacement: path.resolve(__dirname, '../spec/src/kernel/index.ts') },
      { find: '@objectstack/spec/shared', replacement: path.resolve(__dirname, '../spec/src/shared/index.ts') },
      { find: '@objectstack/spec/system', replacement: path.resolve(__dirname, '../spec/src/system/index.ts') },
      { find: '@objectstack/spec/ui', replacement: path.resolve(__dirname, '../spec/src/ui/index.ts') },
      // [ADR-0105 D1] Reached transitively via `@objectstack/types` (tenancy posture).
      { find: '@objectstack/spec/security', replacement: path.resolve(__dirname, '../spec/src/security/index.ts') },
      { find: '@objectstack/spec', replacement: path.resolve(__dirname, '../spec/src/index.ts') },
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
