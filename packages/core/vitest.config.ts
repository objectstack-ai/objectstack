// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { configDefaults, defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import path from 'path';
import { parseCLI } from 'vitest/node';
import {
  exactAndGlobPopulations,
  runFilterPreflight,
  runProjectCliOverridePreflight,
} from '../qa/vitest-filter-preflight/src/index.js';

// #16466 -- two vitest projects, two turbo tasks. `repo` owns the tests that read
// outside this package (the list is vitest.repo-tests.json, which
// check:cross-package-test-inputs holds equal to its own scan); `local` owns
// every other test file. turbo hashes the wide `$TURBO_ROOT$` inputs on
// `test:repo` only, so `test` stays cacheable across changes elsewhere in the
// repo. `extends: true` keeps the root options (aliases included) on both.
const REPO_TESTS: string[] = JSON.parse(readFileSync(path.join(__dirname, 'vitest.repo-tests.json'), 'utf8'));

// #17853 / #17978 — say so when a path named on the command line will run no
// tests. Invoked HERE, at config load, and ⛔ deliberately NOT as a
// `test.reporters` entry: naming that option replaces vitest's own reporter
// defaulting instead of extending it, which measurably changes a healthy run's
// output and would drop the `github-actions` reporter in CI. The ONE shared
// transcription of vitest's `TestProject.filterFiles` carries both measurements,
// and it is imported by RELATIVE PATH rather than by its package name for a
// third measured reason recorded in its header. It reads the argv through
// vitest's own exported parser and writes nothing whatever unless a named path
// selects nothing.
//
// `local` takes a GLOB `include`, so its population is derived as a deliberate
// SUPERSET — every test file under this package, minus `REPO_TESTS` — which
// makes a false accusation structurally impossible and leaves drift able only
// to under-report. ⛔ Not a second run of vitest's own glob engine.
runFilterPreflight({
  argv: process.argv,
  root: __dirname,
  packageName: '@objectstack/core',
  populations: exactAndGlobPopulations({
    root: __dirname,
    exact: { repo: REPO_TESTS },
    globProject: 'local',
  }),
  parse: parseCLI,
});

// #18788 — the same narrowing, the same failure direction, a different input.
// `projects` also swallows a CLI TIMEOUT OVERRIDE: vitest 4.1.11 carries only a
// closed twenty-name allowlist into a project config, `hookTimeout` and
// `teardownTimeout` are not on it, and a run naming one silently uses the
// DEFAULT budget and reports a pass that MEASURED NOTHING. That flag is the
// instrument this repo's own prior art reaches for to witness a cold load
// leaving a clocked window, so the green it returns in a `projects` package is
// indistinguishable from one that passed. The run is REFUSED instead, loudly,
// naming the spellings that DO bite here — ⛔ never forwarded into the projects
// below; the shared module's header carries the measured table, the three
// routes and why this is the one. Every package that declares `projects` calls
// this, and `test/config-wiring-sweep.test.ts` spawns a real vitest child per
// package to prove the refusal is a behaviour rather than a spelling.
runProjectCliOverridePreflight({
  argv: process.argv,
  packageName: '@objectstack/core',
  parse: parseCLI,
});

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
