---
"@objectstack/lint": patch
---

fix(lint): wire `packages/lint`'s test layer into `check:test-typecheck`, so its 2,700-line rule pin file is actually type-checked (#14173)

`packages/lint/tsconfig.json` excluded `**/*.test.ts` and `**/*.spec.ts`, and
the package's `typecheck` script was a bare `tsc --noEmit` against that very
config — so no gate anywhere read a lint test file with a type checker.
`src/validate-expressions.test.ts` alone is ~2,700 lines built almost entirely
out of compile-time and meta pins (the #5017 receiver scan, the
`TRACKED_UNDECLARED_READS` shrink-only list, the residual-root table), and none
of it was type-checked by anything: vitest transpiles through esbuild (types
stripped, never resolved), so a wrong key or a signature drift in a pin's own
scaffolding was caught by nobody.

Onboarded by *wiring* to the mechanism #14062 (PR #14420) landed on
(`scripts/check-test-typecheck.mts`), per the triage ruling on this card: a
sibling `tsconfig.test.json` matching vitest's real module semantics
(`module: esnext`, `moduleResolution: bundler`, `lib: ["ES2022"]`; strictness
and `rootDir` untouched, inherited), named by `typecheck`. Measured (workspace
closure built first): 6 residual errors over 2 files, all TS6059 (imports from
`examples/app-showcase`, outside this package's `rootDir` — pre-existing,
config-tier, not a lint defect), recorded EXACT and shrink-only in the new
`test-typecheck-debt.json`.

This is a CONVERSION of the coverage gate's existing `@objectstack/lint`
TEST_DEBT entry (`errors: 16`), not a new debt-opening decision: the same
authority that recorded the 16 now holds the residue one level finer, per file
and per signature, and the coverage-gate entry is deleted as the graduation
that pairing forces. No test file is edited — opening the ratchet is not the
same job as paying it down.
