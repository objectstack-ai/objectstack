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
