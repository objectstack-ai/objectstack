---
"@objectstack/driver-mongodb": patch
---

fix(driver-mongodb): put the test layer in front of tsc, so the package's own typecheck reports a PASS and not a NUMBER (#14917)

`packages/drivers/driver-mongodb`'s `tsconfig.json` excluded `**/*.test.ts`, and
its `typecheck` script is `tsc --noEmit` against that very config. Measured at
`6ed4b811af` with the dependency closure built: that program admits **0** of the
package's 30 `src/**/*.test.ts` files while all **10** of its non-test `src/**`
files ARE there, so `pnpm --filter @objectstack/driver-mongodb typecheck`
exiting 0 was a true sentence carrying no information about any test file.

The filing's headline — that a compile-time `Equals` / `IsAny` pin here is
"checked by nothing" — is **false**, and the correction on the card is right: a
second program does compile these files. `check-type-check-coverage.mjs`'s
`remeasureProject` drops only the test glob and compares the result against its
`TEST_DEBT` ledger. Confirmed here by ablation rather than argued: a
deliberately false `Equals` pin added to `mongodb-driver.test.ts` takes that
program from 10 errors to 11, above the ledger's recorded 10, which reddens it.
The pins were never phantoms. What was true is narrower, and is what this change
closes: the only program reading this layer was a **debt ratchet** — an
instrument that reports a number and fails when the number moves, not a gate
that reports a pass.

Gives the package the #5286 sibling shape (`packages/rest`, `runtime`,
`objectql`, `core`): a `tsconfig.test.json` with module semantics only —
`esnext` / `bundler` / `lib: ES2022`, matching how vitest actually executes
these files — strictness inherited and untouched, named by the `typecheck`
script via `check:test-typecheck`.

Measured: **10** errors under the ratchet's shape (matching its recorded number,
and its recorded composition `TS1309 x7, TS2550 x3`, class for class), and **0**
under the split. All 10 were config-tier in full — 7 `TS1309` (`await` at module
scope in a program NodeNext compiles as CJS, because this package has no `"type":
"module"`) and 3 `TS2550` (`Array.prototype.at` against a `lib` older than
es2022). Neither class says anything about a test, and nothing was exposed
behind them: there was no unresolved-import cascade here to collapse, so there
is no `+n` term. `noUnusedLocals` / `noUnusedParameters` are live for this
package (unlike `driver-turso`, which switches both off) and neither fires.

The `TEST_DEBT` entry (10 errors) is **deleted**, not lowered — the graduation
this ratchet's invariant requires. No `test-typecheck-debt.json` is added:
residue is 0, so none is owed (#5286, maintainer-only to open). That leaves all
30 files unledgered, so any error any one of them gains is red on arrival.

`check:type-source-resolution` went red from onboarding the new program (the
documented onboarding-limb case, #11490): a registry entry is added rather than
`paths`, with its numbers stated in place — 123 tsc programs / 309 pairs before,
124 / 310 after. The single new pair is `@objectstack/objectql`, a devDependency
that no non-test file in `src/` imports.

No runtime code changes: not one test file and not one source file is edited, so
no shipped behaviour moves — the suite reports the same 552 passed / 147 skipped
across 30 files as before. The `patch` level reflects the published
`package.json` gaining `typecheck` / `check:test-typecheck` scripts and a `tsx`
devDependency.
