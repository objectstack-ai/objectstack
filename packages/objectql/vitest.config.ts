// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// This config exists for exactly one setting; everything else stays on
// vitest's defaults, deliberately — a key added here re-specifies behaviour
// for every test file in the package (packages/cli/vitest.config.ts's header
// records the incident that taught that).
//
// ── #13517: this suite asks the SchemaRegistry for quiet, DECLARATIVELY ─────
//
// Measured on THIS suite (one full `pnpm --filter @objectstack/objectql test`,
// `origin/main` b1b7d6088a): 16,194 lines on the run's stdout, 4,744 of them
// `[Registry] …`. 10,984 of the rest are the structured logger's
// `<ts> INFO …` lines, which do not go through `console` at all and are NOT
// what this key reaches (#13986) — so against the console-carried population
// this suite emits, `[Registry]` is 4,744 of 5,210 = 91.1%, and 3,869 of those
// are the single `Registered object:` line, emitted once per registered object
// per registry construction across the package's 250 test files.
//
// `OS_REGISTRY_LOG` is `@objectstack/objectql`'s OWN published seam for that
// verbosity (`SchemaRegistryOptions.logLevel` / `REGISTRY_LOG_LEVELS`,
// registry.ts) — at `warn` the registry's private `log()` returns before
// writing. What it does NOT silence is the diagnostics: the ADR-0005
// `[Registry] Collision` lines go through a bare `console.warn` that the level
// never gates, so a real shadowing still speaks here — measured, not inferred:
// `registry-collision-order.test.ts` passes identically on both sides, and it
// sets `logLevel = 'silent'` per registry anyway.
//
// ⛔ Two things this deliberately is NOT. It does not move the engine's
// SHIPPED default (still `'info'` at registry.ts:1265, unchanged for every
// production reader), and it does not make library code sniff
// `process.env.VITEST` — a library that behaves differently under a test
// runner would make every log reading in tests a reading of something other
// than production. The request lives HERE, in the harness, where the test
// author can see it.
//
// ⚠️ One test file in THIS package reads the same env var as its subject:
// `registry-log-level.test.ts` pins how `OS_REGISTRY_LOG` resolves. It now
// deletes the var in `beforeEach` (it already did in `afterEach`) and asserts
// the level its "default" cases actually run at, so the harness key below
// cannot silently re-point that file's premise. Without those two lines the
// file's first case stays GREEN while testing `'warn'` under a name that says
// `info` — measured red before they were added.
import { configDefaults, defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
  packageName: '@objectstack/objectql',
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
  packageName: '@objectstack/objectql',
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
          // #13517: quiet the registry's per-item registration chatter — the
          // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
          // default. Enforced by scripts/check-registry-log-declared.mjs.
          env: { OS_REGISTRY_LOG: 'warn' },
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
          // #13517: quiet the registry's per-item registration chatter — the
          // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
          // default. Enforced by scripts/check-registry-log-declared.mjs.
          env: { OS_REGISTRY_LOG: 'warn' },
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
    // #13517: quiet the registry's per-item registration chatter — the
    // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
    // default. Header docblock carries the measurement and the rationale.
    env: { OS_REGISTRY_LOG: 'warn' },
  },
});
