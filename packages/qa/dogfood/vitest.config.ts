// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Two projects, one suite (#3622 follow-up: dogfood boot-overhead surgery).
//
// Measured on this suite: test BODIES are ~61s of aggregate compute while
// per-file setup (TS module graph ~3.5s + kernel boot ~4.1s + hooks) is
// ~800s — ~93% of the gate's cost was booting the same app over and over.
//
// `shared-showcase` runs the files that boot the IDENTICAL plain showcase
// stack with `isolate: false`: files on the same worker share one module
// registry, so test/shared-showcase.ts memoizes ONE boot per worker instead
// of one per file. Eligibility rules live in that helper's header — files
// with custom boot options, /meta writes, org/BU mutation, exact-count
// assertions over shared objects, or process.env toggles stay isolated.
//
// `isolated` keeps vitest defaults (fresh fork registry per file) for
// everything else — fixture stacks, custom security/plugins, env-flag files.
//
// ── #13517: this suite asks the SchemaRegistry for quiet, DECLARATIVELY ─────
//
// Measured on this suite (one full run, `origin/main` eb649cb8bc): 66,976
// lines on the run's stdout, 39,738 of them `[Registry] …` — 94.9% of
// everything this suite writes through `console`. They are per-item
// registration lines (`Registered object/namespace/action/view/…`), emitted
// once per registered item per app boot, and this suite boots real example
// apps ~130 times.
//
// `OS_REGISTRY_LOG` is `@objectstack/objectql`'s OWN published seam for that
// verbosity (`SchemaRegistryOptions.logLevel` / `REGISTRY_LOG_LEVELS`,
// registry.ts) — at `warn` the registry's private `log()` returns before
// writing. What it does NOT silence is the diagnostics: the ADR-0005
// `[Registry] Collision` lines go through a bare `console.warn` that the
// level never gates, so a real shadowing still speaks here.
//
// ⛔ Two things this deliberately is NOT. It does not move the engine's
// SHIPPED default (still `'info'`, unchanged for every production reader),
// and it does not make library code sniff `process.env.VITEST` — a library
// that behaves differently under a test runner would make every log reading
// in tests a reading of something other than production. The request lives
// HERE, in the harness, where the test author can see it.
import { defineConfig } from 'vitest/config';
import path from 'path';
import { parseCLI, type TestUserConfig } from 'vitest/node';
import {
  exactAndGlobPopulations,
  runFilterPreflight,
  runProjectCliOverridePreflight,
} from '../vitest-filter-preflight/src/index.js';

// Files proven eligible for the worker-shared plain showcase stack.
const SHARED_SHOWCASE = [
  'test/form-self-auth.dogfood.test.ts',
  'test/showcase-agent-intersection.dogfood.test.ts',
  'test/showcase-agent-scope-ceiling.dogfood.test.ts',
  'test/showcase-anonymous-deny.dogfood.test.ts',
  'test/showcase-anonymous-deny-surfaces.dogfood.test.ts',
  'test/showcase-declarative-rbac-seeding.dogfood.test.ts',
  'test/showcase-permission-zoo.dogfood.test.ts',
  'test/showcase-private-owd.dogfood.test.ts',
  'test/showcase-public-read-owd.dogfood.test.ts',
  'test/showcase-readonly-when-parent.dogfood.test.ts',
  'test/showcase-search.dogfood.test.ts',
  'test/showcase-static-readonly.dogfood.test.ts',
  'test/two-doors-permission.dogfood.test.ts',
];

// Commit 08f5f0e5a / #17978 — say so when a path named on the command line will run no
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
// `isolated` takes a GLOB `include`, so its population is derived as a
// deliberate SUPERSET — every test file under this package, minus
// `SHARED_SHOWCASE` — which makes a false accusation structurally impossible and
// leaves drift able only to under-report. ⛔ Not a second run of vitest's own
// glob engine.
runFilterPreflight({
  argv: process.argv,
  root: __dirname,
  packageName: '@objectstack/dogfood',
  populations: exactAndGlobPopulations({
    root: __dirname,
    exact: { 'shared-showcase': SHARED_SHOWCASE },
    globProject: 'isolated',
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
  packageName: '@objectstack/dogfood',
  parse: parseCLI,
});

// #20820 -- THE FILE-LEVEL SLICE ARRIVES AS AN ENV VAR, NOT AS A PASSTHROUGH.
// The `Dogfood Regression Gate (k/3)` leg runs `OS_TEST_SHARD=k/3 turbo run test`,
// the same carrier `packages/cli/vitest.config.ts` documents (#19278). The value
// reaches vitest HERE because vitest reads no shard variable of its own, and it
// reaches this process at all only because `turbo.json` declares `OS_TEST_SHARD`
// in THIS package's `@objectstack/dogfood#test` task `env` (a per-package task
// entry REPLACES the shared `test` entry's env, it does not extend it -- the
// shared declaration does not cover this package) -- which is also what puts the
// slice in the task hash. Unset (every local run) it is `undefined` and the run
// is unsharded; a `--shard` on the command line still wins, because vitest
// merges the CLI options OVER this block.
//
// Why a passthrough (`-- --shard=k/3`) is no longer the carrier: turbo folds a
// run-level passthrough into the hash of every task in the run, so the leg had
// to be `--only`, and `--only` drops the `^build` closure out of the test's hash
// -- a shard could replay a main-seeded cache entry across an upstream change
// that put it in the affected set. An env declared on the task reaches only the
// task. `shard` is typed through `TestUserConfig` because vitest declares it on
// its CLI options and not on `InlineConfig`; it sits on the ROOT `test` block
// (the projects below do not carry it), where vitest resolves it for all of them.
//
// #21914 -- EVERY TEST FILE RUNS IN ITS OWN TEMPORARY WORKING DIRECTORY.
// Showcase boots write `.objectstack/data/showcase_external.db` relative to the
// cwd. From the package directory that file outlived the run, and a later boot's
// federated state depended on which files ran before it. Two halves:
//   - `PER_FILE_CWD` is a `setupFiles` entry named in EACH project below, because
//     inline projects inherit nothing from this root block (the same measured gap
//     as `disableConsoleIntercept`). It `chdir`s into a fresh directory before the
//     test file's imports, restores the cwd in `afterAll`, and THROWS there when
//     `.objectstack/data` exists in the package directory: that throw is the guard.
//   - The `globalSetup` below is ROOT-level: one run, one call, covering both
//     projects and each `OS_TEST_SHARD` slice (measured). It clears a stale
//     `.objectstack` at the start and removes the run's temporary root at the end.
//     Its teardown judges nothing, because a throw there exits 0 on vitest 4.1.11.
// Both modules' headers carry the rest, including what a dogfood author owes.
const PER_FILE_CWD = './test/per-file-cwd.setup.ts';

export default defineConfig({
  test: {
    // The file-level slice, when the dogfood gate runs one (#20820) -- see the
    // section above `export default` for why it is spread and typed this way.
    ...({ shard: process.env.OS_TEST_SHARD } satisfies Pick<TestUserConfig, 'shard'>),
    // #21914: the run-level half of the per-file working directory (section above).
    globalSetup: ['./test/per-file-cwd.global-setup.ts'],
    projects: [
      {
        test: {
          // #10374: disarm the late-console teardown race. Set PER PROJECT because
          // inline projects do not inherit the root-level setting (measured on
          // vitest 4.1.10). Mechanism: examples/app-showcase/vitest.config.ts.
          // Enforced by scripts/check-console-intercept-disarm.mjs.
          disableConsoleIntercept: true,
          // #13517: quiet the registry's per-item registration chatter — the
          // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
          // default. Header docblock carries the measurement and the rationale.
          // PER PROJECT for the same measured reason as the line above.
          env: { OS_REGISTRY_LOG: 'warn' },
          name: 'shared-showcase',
          include: SHARED_SHOWCASE,
          isolate: false,
          // #21914: PER PROJECT, like the two settings above. With `isolate: false`
          // the module still runs once per file, so each file gets its own cwd.
          setupFiles: [PER_FILE_CWD],
        },
      },
      {
        // [#16679] `resolve.alias` at the ROOT of this config is NOT
        // inherited by `test.projects[]` — measured empirically (a
        // deliberately broken replacement path for
        // `@objectstack/plugin-approvals` still resolved through `dist/`
        // with zero errors), the same "inline projects do not inherit the
        // root-level setting" gap #10374 already found for
        // `disableConsoleIntercept` on Vitest 4.1.10. A root-level `alias:`
        // entry here would read as live but be dead for every test in
        // EITHER project — which is precisely the false-green
        // `check-test-source-alias` exists to prevent. So it lives HERE,
        // on the one project whose test files actually import these
        // specifiers (none of `SHARED_SHOWCASE`'s files do — grepped).
        //
        // It must also be an INLINE array literal, not a shared constant:
        // `check-test-source-alias` parses this file's TEXT statically (it
        // does not evaluate the config) and reads the first `alias:
        // [...]`/`alias: {...}` region it finds — `alias: SOME_CONST_NAME`
        // is invisible to it and silently drops every entry, root ones
        // included. Anchored array form (not the object form) is also
        // load-bearing: the object form matches by PREFIX and would swallow
        // subpath imports (the ENOTDIR trap the gate's header names).
        resolve: {
          alias: [
            // [#7865] `federated-anchor-provenance.dogfood.test.ts` imports
            // the provenance marker from `@objectstack/metadata-core` —
            // alias it to SOURCE so the pin is a verdict about the checkout,
            // not about a build artifact (#7668 is what a dist-resolved pin
            // costs).
            {
              find: /^@objectstack\/metadata-core$/,
              replacement: path.resolve(__dirname, '../../metadata-core/src/index.ts'),
            },
            // [#13513] `date-bucket-parity-turso.test.ts` drives
            // `TursoDriver` itself — it asserts the driver's SQL date
            // bucketing against the in-memory reference, plus the on-disk
            // storage form SqlDriver writes. That verdict has to be about
            // the driver source in this checkout, not about the last `pnpm
            // build`, and it was: the suite used to live inside
            // `packages/drivers/driver-turso` and imported
            // `./turso-driver.js` relatively. It moved here because the
            // `@objectstack/verify` devDependency it needs was the one edge
            // that made this workspace's manifest graph cyclic; this alias
            // is what keeps the move semantics-preserving rather than
            // quietly converting a source pin into a dist pin.
            {
              find: /^@objectstack\/driver-turso$/,
              replacement: path.resolve(__dirname, '../../drivers/driver-turso/src/index.ts'),
            },
            // [#16679] `approval-override-composite-pin.dogfood.test.ts`
            // evaluates the SERVED `sys_approval_request` action predicates
            // against the SERVED viewer with `@objectstack/formula`'s
            // `celEngine` — a dist merely behind would run the composite
            // green against the engine's old semantics, exactly the #8990
            // hazard `action-predicate-sparse-face.test.ts` (that package's
            // own alias) already documents for this same engine.
            // `@objectstack/plugin-approvals` and
            // `@objectstack/trigger-record-change` are the pin's subject —
            // the whole point is that a change to either can silently break
            // the override composite, so the pin has to be a verdict about
            // THIS checkout's source, not the last `pnpm build`.
            {
              find: /^@objectstack\/formula$/,
              replacement: path.resolve(__dirname, '../../formula/src/index.ts'),
            },
            {
              find: /^@objectstack\/plugin-approvals$/,
              replacement: path.resolve(__dirname, '../../plugins/plugin-approvals/src/index.ts'),
            },
            {
              find: /^@objectstack\/trigger-record-change$/,
              replacement: path.resolve(__dirname, '../../triggers/trigger-record-change/src/index.ts'),
            },
            // [commit ecdfc9411] `schedule-acting-organization.dogfood.test.ts` and
            // `schedule-sweep-organization-scope.dogfood.test.ts` drive
            // `ScheduleTrigger` / `TimeRelativeTrigger` themselves: the pins'
            // whole subject is which
            // organization the trigger puts on the run it launches, which
            // organization its SWEEP QUERY is scoped to, and that a flow
            // declaring none is refused at bind. A dist merely behind
            // would run the pin green against the trigger's OLD context
            // construction — the exact shape this card is about, since the
            // defect was a run that reported itself healthy while carrying
            // nothing. Aliased to source so the verdict is about THIS
            // checkout.
            {
              find: /^@objectstack\/trigger-schedule$/,
              replacement: path.resolve(__dirname, '../../triggers/trigger-schedule/src/index.ts'),
            },
            // [#20790] `flow-credential-channel.dogfood.test.ts` drives
            // `ApiTrigger` itself: the pin's subject is that the inbound door
            // verifies against the secret the write-only flow credential
            // channel holds, read at verification time. A dist merely behind
            // would verify with the trigger's OLD literal-only arming, so the
            // verdict is aliased to THIS checkout's source.
            {
              find: /^@objectstack\/trigger-api$/,
              replacement: path.resolve(__dirname, '../../triggers/trigger-api/src/index.ts'),
            },
            // [#21728] `install-local-purge-sample-data.dogfood.test.ts` mounts
            // `MarketplaceInstallLocalPlugin` on a real boot and drives its
            // install / purge / reseed doors. The plugin is the pin's subject,
            // so the verdict is aliased to THIS checkout's source. A relative
            // import of the plugin file instead would put its own dynamic
            // `@objectstack/runtime` import into this package's unaliased set
            // (`check:test-source-alias`), which is shrink-only.
            {
              find: /^@objectstack\/cloud-connection$/,
              replacement: path.resolve(__dirname, '../../cloud-connection/src/index.ts'),
            },
            // [#21788] `external-import-saves-like-meta.dogfood.test.ts` mounts
            // `ExternalDatasourceServicePlugin` on a real boot (the harness
            // does not) and drives the import door. The plugin's save path is
            // the pin's subject, so the verdict is aliased to THIS checkout's
            // source, not to the last `pnpm build`.
            {
              find: /^@objectstack\/service-datasource$/,
              replacement: path.resolve(__dirname, '../../services/service-datasource/src/index.ts'),
            },
          ],
        },
        test: {
          // #10374: disarm the late-console teardown race. Set PER PROJECT because
          // inline projects do not inherit the root-level setting (measured on
          // vitest 4.1.10). Mechanism: examples/app-showcase/vitest.config.ts.
          // Enforced by scripts/check-console-intercept-disarm.mjs.
          disableConsoleIntercept: true,
          // #13517: quiet the registry's per-item registration chatter — the
          // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
          // default. Header docblock carries the measurement and the rationale.
          // PER PROJECT for the same measured reason as the line above.
          env: { OS_REGISTRY_LOG: 'warn' },
          name: 'isolated',
          include: ['test/**/*.test.ts'],
          exclude: SHARED_SHOWCASE,
          // #21914: PER PROJECT, as in `shared-showcase` above.
          setupFiles: [PER_FILE_CWD],
        },
      },
    ],
  },
});
