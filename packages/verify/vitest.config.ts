// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// This config exists for exactly one setting; everything else stays on
// vitest's defaults, deliberately — a key added here re-specifies behaviour
// for every test file in the package (packages/cli/vitest.config.ts's header
// records the incident that taught that).
//
// ── #13517: this suite asks the SchemaRegistry for quiet, DECLARATIVELY ─────
//
// Measured on THIS suite (one full `pnpm --filter @objectstack/verify test`,
// `origin/main` b1b7d6088a): 5,670 lines on the run's stdout, 2,323 of them
// `[Registry] …`. 3,113 of the rest are the structured logger's `<ts> INFO …`
// lines, which do not go through `console` at all and are NOT what this key
// reaches (#13986) — so against the console-carried population this suite
// emits, `[Registry]` is 2,323 of 2,557 = 90.8%. This package boots real app
// stacks in its harness, so the count is per-boot registration chatter.
//
// `OS_REGISTRY_LOG` is `@objectstack/objectql`'s OWN published seam for that
// verbosity (`SchemaRegistryOptions.logLevel` / `REGISTRY_LOG_LEVELS`,
// registry.ts) — at `warn` the registry's private `log()` returns before
// writing. What it does NOT silence is the diagnostics: the ADR-0005
// `[Registry] Collision` lines go through a bare `console.warn` that the level
// never gates, so a real shadowing still speaks here.
//
// ⛔ Two things this deliberately is NOT. It does not move the engine's
// SHIPPED default (still `'info'` at objectql's registry.ts:1265, unchanged
// for every production reader), and it does not make library code sniff
// `process.env.VITEST` — a library that behaves differently under a test
// runner would make every log reading in tests a reading of something other
// than production. The request lives HERE, in the harness, where the test
// author can see it.
// ── Why there is now a `resolve.alias` (#15229) ────────────────────────────
//
// `artifact-collections.ts` reads the app's collections through
// `resolveArtifactPackageOrder` — `@objectstack/core`'s ADR-0130 D4+D5 package
// ordering — and `derive.ts` / `rls.ts` reach it from every test in this
// package. Without an anchored alias that specifier resolves through core's
// `exports` to its **dist**, which makes each of those tests a verdict about
// build state rather than about the source in this checkout, and the dangerous
// half of that is not a loud error but a suite that passes GREEN over a stale
// artifact with nothing in the output saying so.
// `scripts/check-test-source-alias.mjs` names it; that script's registry is
// SHRINK-ONLY, so widening `KNOWN_UNALIASED_TEST_IMPORTS['@objectstack/verify']`
// was never the fix. ANCHORED (`/^…$/`, array form) so the entry cannot swallow
// core's published subpaths and resolve `@objectstack/core/logger` to
// `…/core/src/index.ts/logger` — the ENOTDIR shape that gate's rule 5 exists
// for. The 14 other entries in this package's ledger are real and untouched:
// this adds nothing to it and removes nothing from it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@objectstack\/core$/, replacement: path.resolve(HERE, '../core/src/index.ts') },
    ],
  },
  test: {
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
