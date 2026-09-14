// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { configDefaults, defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCLI } from 'vitest/node';
import {
  exactAndGlobPopulations,
  runFilterPreflight,
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
  packageName: '@objectstack/spec',
  populations: exactAndGlobPopulations({
    root: __dirname,
    exact: { repo: REPO_TESTS },
    globProject: 'local',
  }),
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
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...REPO_TESTS],
          globals: true, environment: 'node', testTimeout: 60_000,
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
          globals: true, environment: 'node', testTimeout: 60_000,
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
    // The 17 export-surface pins that used to load the TypeScript compiler and
    // type-resolve the whole export surface inside a test case no longer do:
    // #4796 lifted that resolution into the `export-origins/` build-time
    // baseline and the pins now compare against it. This value is what remains
    // of the two stop-the-bleed laps (#4850 → 60s, #4864 → 30s) that kept those
    // cases off vitest's 5000ms default while they still compiled.
    //
    // Keep it. Two `createProgram` cases survive deliberately —
    // `data/driver.test.ts` and `ui/app.test.ts` assert TYPE WRITABILITY of
    // retired keys, which is a different fact from export origin and which no
    // export-surface baseline can carry — and the headroom is what stops them
    // riding the same timeout line the export-surface family used to. The value
    // itself is left exactly where the stop-bleed put it — lowering it is a
    // separate decision, with its own measurement, and not this change's to make.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.zod.ts'],
      exclude: ['node_modules', 'dist', 'scripts'],
    },
  },
});
