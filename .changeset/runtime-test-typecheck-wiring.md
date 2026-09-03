---
"@objectstack/runtime": patch
---

fix(runtime): wire `packages/runtime`'s test layer into `check:test-typecheck`, so its 214 test files are type-checked at all (#14504)

`packages/runtime/tsconfig.json` excluded `**/*.test.ts` and `**/*.spec.ts`, and
the package's `typecheck` script was a bare `tsc --noEmit` against that very
config — so no gate anywhere read a runtime test file with a type checker.
Measured at `224f8ea4a0` with the workspace closure built first, rather than
read off the config: `tsc --noEmit --listFiles -p tsconfig.json` puts 899 files
in the program and **0** of the package's 214 `src/**/*.test.ts` among them,
while 79 of its non-test `src/**` files ARE there — so the zero is the
`exclude` line, not a probe that sees nothing. The directional control is
`packages/drivers/driver-memory`, whose tsconfig carries no test exclusion: the
same probe puts 40 of its 40 test files in the program. Under the new
`tsconfig.test.json` the count is **214 of 214**.

Onboarded by *wiring* to the shared mechanism (`scripts/check-test-typecheck.mts`)
the way `objectql`, `rest`, `lint` and the fourteen `packages/plugins/**` are
wired, never by copying it: a sibling `tsconfig.test.json` matching vitest's
real module semantics (`module: esnext`, `moduleResolution: bundler`,
`lib: ["ES2022"]`), named by `typecheck` via `check:test-typecheck --project`.
Strictness and `rootDir` are untouched and inherited; not one `any` and not one
`@ts-expect-error` was added to any test file to open the gate.

**Seeded, not repaired, per this card's triage ruling.** The layer reports 191
errors across 27 files and they are recorded EXACT and shrink-only in the new
`test-typecheck-debt.json`. Every one is pre-existing: no test file is edited
here. The other 187 files carry no entry, so any error they gain is red on
arrival.

This is a CONVERSION rather than a new debt-opening decision. The same program
under the build config's inherited NodeNext reports 206 — exactly the number
`scripts/check-type-check-coverage.mjs` already held for this package in its
per-PACKAGE `TEST_DEBT` ledger — and that entry graduates here, as the pairing
forces. The 206 → 191 step is attributed in both directions with no remainder:
−19 config-tier diagnostics that dissolve under vitest's module semantics
(TS2835 ×13, the TS7006 ×4 cascading above them, TS2550 ×2) and +4 that
collapsing the cascade exposed (TS2322 ×4 in `src/seed-loader.test.ts`,
previously masked by an `any` from the unresolved import).
