// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { configDefaults, defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import path from 'path';
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
  packageName: '@objectstack/rest',
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
          include: configDefaults.include,
          exclude: [...configDefaults.exclude, ...REPO_TESTS],
          globals: true, environment: 'node',
          // #13517: quiet the registry's per-item registration chatter — the
          // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
          // default. Enforced by scripts/check-registry-log-declared.mjs.
          // #15484 / #17865: `OS_REST_LOG` is this package's OWN declared
          // fault-log level seam (packages/rest/src/log.ts). A ROOT-level value
          // is inert for a project run, so it is declared here too. See the root
          // block for the measured reason this HARNESS runs quiet while the
          // shipped default stays `'info'`, and for the two things the quiet
          // level does not work without.
          env: { OS_REGISTRY_LOG: 'warn', OS_REST_LOG: 'silent' },
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
          // #13517: quiet the registry's per-item registration chatter — the
          // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
          // default. Enforced by scripts/check-registry-log-declared.mjs.
          // #15484 / #17865: `OS_REST_LOG` is this package's OWN declared
          // fault-log level seam (packages/rest/src/log.ts). A ROOT-level value
          // is inert for a project run, so it is declared here too. See the root
          // block for the measured reason this HARNESS runs quiet while the
          // shipped default stays `'info'`, and for the two things the quiet
          // level does not work without.
          env: { OS_REGISTRY_LOG: 'warn', OS_REST_LOG: 'silent' },
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
    // #13517 / #15425: quiet the SchemaRegistry's per-item registration
    // chatter — the engine's OWN `OS_REGISTRY_LOG` seam
    // (`SchemaRegistryOptions.logLevel` / `REGISTRY_LOG_LEVELS`, objectql's
    // registry.ts), not a change to its shipped 'info' default and not a
    // library that sniffs `process.env.VITEST`. ⭐ This suite is the one
    // `docs/audits/2026-09-test-log-volume-census.md` kept as its untouched
    // CONTROL while #13985/#14016 quieted four others, and it measures 528
    // residual `[Registry]` lines here — eight times what declared objectql
    // still emits. Six test files in this package construct bare registries.
    // The ADR-0005 `[Registry] Collision` diagnostics go through a bare
    // `console.warn` the level never gates, so a real shadowing still speaks.
    // Enforced by scripts/check-registry-log-declared.mjs.
    // #15484 / #17865: `OS_REST_LOG` — this package's own declared fault-log
    // level seam (`packages/rest/src/log.ts`, `REST_LOG_LEVELS`), enforced by
    // `scripts/check-rest-log-declared.mjs`. ⛔ This is the HARNESS's level, not
    // the product's: the SHIPPED default is still `'info'` and still gate-pinned,
    // and nothing here changes what a real caller gets.
    //
    // ⚠️ MEASURED on this suite, both before and after. At `'info'` a green run
    // captured 5,705 lines of which 2,095 (36.7%) were indented `at ` stack
    // frames, 100% of them arriving through `logError`; at `'silent'` that
    // population is ZERO. But the quiet level alone is NOT a volume tidy — it
    // moves this suite's fault-logging assertions in two opposite and equally
    // wrong directions at once:
    //
    //   * assertions that read the fault through a `vi.spyOn(console, 'error')`
    //     mock go RED. They are the "the operator still gets the words" half of
    //     the contract, and they never printed any of the volume in the first
    //     place.
    //   * the OTHER half asserts that an EXPECTED 4xx logs NOTHING
    //     (`expect(unhandledLogs()).toHaveLength(0)` and siblings). Silencing the
    //     shim makes those pass for the wrong reason: they would stay green with
    //     every expected 4xx logged loudly. That is the phantom-check shape this
    //     repo refuses, arrived at by a legitimate-looking declaration — exactly
    //     how the `[Registry]` control on #15484 was silently spent by #15425.
    //
    // ⇒ The quiet level is therefore paired, in the SAME delivery, with two
    // things it does not work without (decision batch #128 item 4, #17865):
    // every test file that observes the fault log declares its own loud level
    // (`vi.stubEnv('OS_REST_LOG', …)` in that file's own setup), and
    // `scripts/check-rest-log-spy-declared.mjs` makes an undeclared observer a
    // finding by name — so a future test cannot assert silence into a silenced
    // suite. ⛔ Do not raise this value back to a loud one to "fix" a red test:
    // the file that went red is the one missing its own declaration.
    env: { OS_REGISTRY_LOG: 'warn', OS_REST_LOG: 'silent' },
    globals: true,
    environment: 'node',
  },
  resolve: {
    // Both entries exist for `remote-tables-twin.equivalence.test.ts` (#7955),
    // the one suite here that imports sibling packages as VALUES: it mounts the
    // `service-datasource` admin registrar next to this package's federation
    // registrar to pin that the two `listRemoteTables` spellings answer `?schema=`
    // identically, and drives both through the real Hono adapter.
    //
    // Unaliased, those two specifiers resolve through the workspace link to
    // `dist/` — a BUILD ARTIFACT — which makes this suite's verdict a function of
    // build state rather than of the source in the checkout. The loud failure
    // (missing export) is the mild half; a dist merely BEHIND lets the test run
    // GREEN against the dependency's old behaviour, and nothing in the output
    // says so. That is exactly the hazard for a CROSS-PACKAGE equivalence pin:
    // its whole job is to notice when one of the two twins moves, and a stale
    // `service-datasource` dist would report the pre-fix admin route as agreeing
    // with the federation one — the #7955 defect itself, passing.
    //
    // Turbo already orders `test` after `^build`, so `turbo run test` was never
    // the failing path. The paths it does not mediate are: `pnpm test` inside
    // this package, `vitest run <file>`, an editor runner, or an agent working
    // in a tree built at an older commit — which are precisely the ways this pin
    // gets re-run WHILE someone is changing one of the two routes.
    //
    // Array form with anchored patterns, deliberately: the object form matches
    // by PREFIX, so a bare `@objectstack/service-datasource` key with a FILE
    // replacement would also swallow `@objectstack/service-datasource/contracts`
    // and resolve it to `…/src/index.ts/contracts` (ENOTDIR) at run time, in a
    // config that looks right. Same shape as `service-storage`'s config (#7778).
    alias: [
      {
        find: /^@objectstack\/plugin-hono-server$/,
        replacement: path.resolve(__dirname, '../plugins/plugin-hono-server/src/index.ts'),
      },
      {
        find: /^@objectstack\/service-datasource$/,
        replacement: path.resolve(__dirname, '../services/service-datasource/src/index.ts'),
      },
    ],
  },
});
