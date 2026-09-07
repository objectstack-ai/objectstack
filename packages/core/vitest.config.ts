// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { configDefaults, defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import path from 'path';

// #16466 -- two vitest projects, two turbo tasks. `repo` owns the tests that read
// outside this package (the list is vitest.repo-tests.json, which
// check:cross-package-test-inputs holds equal to its own scan); `local` owns
// every other test file. turbo hashes the wide `$TURBO_ROOT$` inputs on
// `test:repo` only, so `test` stays cacheable across changes elsewhere in the
// repo. `extends: true` keeps the root options (aliases included) on both.
const REPO_TESTS: string[] = JSON.parse(readFileSync(path.join(__dirname, 'vitest.repo-tests.json'), 'utf8'));

export default defineConfig({
  test: {
    // Each project re-declares the root block's test options: a ROOT-level
    // value is inert for a project run (measured on vitest 4.1.10, see
    // check-registry-log-declared / check-console-intercept-disarm).
    projects: [
      {
        extends: true,
        test: {
          name: 'local',
          include: configDefaults.include,
          exclude: [...configDefaults.exclude, ...REPO_TESTS],
          globals: true, environment: 'node',
          // A late console.* must not redden a green suite (#10374); see the root
          // block. A ROOT-level value is inert for a project run, so it is
          // declared here as well (scripts/check-console-intercept-disarm.mjs).
          disableConsoleIntercept: true,
        },
      },
      {
        extends: true,
        test: {
          name: 'repo',
          include: REPO_TESTS,
          globals: true, environment: 'node',
          // A late console.* must not redden a green suite (#10374); see the root
          // block. A ROOT-level value is inert for a project run, so it is
          // declared here as well (scripts/check-console-intercept-disarm.mjs).
          disableConsoleIntercept: true,
        },
      },
    ],
    // A late console.* must not redden a green suite (#10374): vitest's worker
    // forwards console output over RPC and discards the promise, and a write
    // landing after teardown's rpcDone() snapshot is rejected into an unhandled
    // error — a fully green run that exits 1. Disarming removes the mechanism.
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
    globals: true,
    environment: 'node',
  },
  resolve: {
    // [#11663 L2] `security/platform-admin.ts` imports `@objectstack/types` as
    // a VALUE — `resolvePlatformOwnerEmail` (the live env read) and
    // `isEmailVerifiedUserRow` (the fail-closed verified allow-list) — so the
    // suites over it must read the producer's SOURCE in this checkout rather
    // than the workspace link's `dist/`. The loud failure (a missing export) is
    // the mild half; a `dist/` merely BEHIND runs GREEN against the
    // dependency's old behaviour and says nothing at all — and the behaviour in
    // question here is which stored `email_verified` representations count as
    // verified, i.e. exactly the predicate that decides who is a superuser.
    // `check:test-source-alias` refuses precisely that shape.
    //
    // Array form with an anchored pattern, deliberately: the object form
    // matches by PREFIX, so a bare key with a FILE replacement would also
    // swallow any subpath import and resolve it to `…/src/index.ts/<subpath>`
    // (ENOTDIR) at run time, in a config that looks right.
    alias: [
      {
        find: /^@objectstack\/types$/,
        replacement: path.resolve(__dirname, '../types/src/index.ts'),
      },
    ],
  },
});
