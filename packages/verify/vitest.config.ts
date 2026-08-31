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
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
