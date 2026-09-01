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

export default defineConfig({
  resolve: {
    // [#7865] `federated-anchor-provenance.dogfood.test.ts` imports the
    // provenance marker from `@objectstack/metadata-core` — alias it to SOURCE
    // so the pin is a verdict about the checkout, not about a build artifact
    // (`check-test-source-alias`; #7668 is what a dist-resolved pin costs).
    // Anchored array form on purpose: the object form matches by prefix and
    // would swallow subpath imports (the ENOTDIR trap the gate's header names).
    // Aliasing is graph-wide, so packages still loaded from dist (objectql,
    // plugin-security, …) resolve their own `@objectstack/metadata-core`
    // imports to this same single source instance rather than a second copy.
    alias: [
      {
        find: /^@objectstack\/metadata-core$/,
        replacement: path.resolve(__dirname, '../../metadata-core/src/index.ts'),
      },
    ],
  },
  test: {
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
        },
      },
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
          name: 'isolated',
          include: ['test/**/*.test.ts'],
          exclude: SHARED_SHOWCASE,
        },
      },
    ],
  },
});
