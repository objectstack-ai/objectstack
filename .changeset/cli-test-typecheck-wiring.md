---
"@objectstack/cli": patch
---

fix(cli): wire `packages/cli`'s test layer into `check:test-typecheck`, so its 115 test files are type-checked at all (#14710)

`packages/cli/tsconfig.json` declares `include: ["src"]` and no `exclude` at
all, and the package's `typecheck` script was a bare `tsc --noEmit` against that
very config — so the 115 test files in the sibling `test/` tree were read by no
tsc program anywhere. This is the shape AGENTS.md already forbids, reached by
the OTHER spelling: not an `exclude` naming the test globs, but an `include`
that never reaches them.

Measured at `5a5336b399` with the workspace closure built first, rather than
read off the config: `tsc --noEmit --listFiles -p tsconfig.json` puts 1009 files
in the program and **0** of the 115 among them, while 119 of 119 non-test
`src/**` files and all 121 `src/**` test files ARE there — so the zero is the
`include` line, not a probe that sees nothing. The directional control is
`packages/drivers/driver-memory`, whose tsconfig carries no test exclusion: the
same probe puts 40 of its 40 test files in the program. Under the new
`tsconfig.test.json` the count is **115 of 115**, plus the three package-root
harness modules (`vitest.config.ts`, `vitest-tiers.ts`,
`vitest-tiers.fixtures.ts`) and `test/helpers/serve-process.ts`.

Onboarded by *wiring* to the shared mechanism (`scripts/check-test-typecheck.mts`)
the way `objectql`, `rest`, `lint`, the fourteen `packages/plugins/**` and
`runtime` are wired, never by copying it: a sibling `tsconfig.test.json`
matching vitest's real module semantics (`module: esnext`,
`moduleResolution: bundler`), named by `typecheck` via
`check:test-typecheck --project`. Strictness is untouched and inherited; not one
`any` and not one `@ts-expect-error` was added to any test file to open the
gate. `rootDir` IS widened to `../..`, the way `packages/client`'s test config
already does it — this package's tests sit outside the build config's
`rootDir: "src"`, and three of them import fixtures from
`examples/app-showcase/src/**`.

**Seeded, not repaired, per this card's triage ruling.** The layer reports 28
errors across 3 files and they are recorded EXACT and shrink-only in the new
`test-typecheck-debt.json`. Every one is pre-existing: no test file is edited
here. The other 112 files carry no entry, so any error they gain is red on
arrival.

This is a CONVERSION rather than a new debt-opening decision. The same
population under the build config's inherited NodeNext reports 144 — exactly the
number `scripts/check-type-check-coverage.mjs` already held for this package in
its per-PACKAGE `TEST_DEBT` ledger, class for class — and that entry graduates
here, as the pairing forces. The 144 → 28 step is attributed in both directions
with no remainder: −120 config-tier diagnostics that dissolve under vitest's
module semantics (TS2835 ×56, the TS7006 ×59 cascading above them, TS2307 ×3,
TS18046 ×2) and +4 that collapsing the cascade exposed (TS18048 ×4 in
`test/i18n-extract-action-description.test.ts`, previously masked by an `any`
from two unresolved imports). The 24 TS2339 survive unchanged, file for file.
