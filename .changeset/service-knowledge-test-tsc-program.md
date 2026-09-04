---
"@objectstack/service-knowledge": patch
---

fix(service-knowledge): put the test layer in front of tsc, and repair the four defects it was hiding (#15049)

`packages/services/service-knowledge` had **no `typecheck` script at all** —
its scripts were `build` and `test` — so no tsc program anywhere read this
package. Turbo/CI typecheck lanes skipped it silently, because a zero-matching
filter run exits 0. `tsup` transpiles with esbuild and `vitest` runs through
esbuild type-**stripping**; neither type-checks. The package's own
`tsconfig.json` does include the tests and always did, so the program that
would have read them already existed and was simply never invoked — the same
shape `@objectstack/service-cluster` (#14181) reached the ledger by.

**Measured before any repair**, dependency closure built first: `tsc --noEmit`
against the existing `tsconfig.json` (undivided, BUILD/NodeNext semantics)
read **10** raw errors, matching the `DEBT` entry this PR deletes exactly. The
new sibling `tsconfig.test.json` (module semantics only — `esnext` / `bundler`
/ `lib: ES2022`, matching how vitest actually executes these files; strictness
untouched) read **4** under the correct split — not the ledger's own 3-code-tier
guess. Fixing the 3 TS2835 (three relative test imports missing `.js`, required
by `moduleResolution: NodeNext`) removed the noise cascade (4 TS7006, every
`(h) => h.documentId)` callback over a `KnowledgeService` search result that
had degraded to `any`) and, in doing so, re-enabled a TypeScript excess-property
check the cascade had been suppressing — uncovering a 4th real error the
undivided reading had masked entirely.

**The four code-tier defects, all in the test file, all in the test file's own
typing — never in `src/`:**

1. `roles: ['member']` in one `ExecutionContext` object literal (TS2353 once
   the excess-property check could see it) — a field the spec renamed to
   `positions` (`execution-context.zod.ts`: *"Position names held by the
   user … Formerly `roles`"*), that no check had ever read against the
   renamed type. Every other `executionContext` literal in this file already
   used `positions`; this one was simply never checked before. Fixed by
   renaming it — `ExecutionContext` itself is untouched and correct.
2. `buildSetup`'s `vi.fn()` stub for `IDataEngine.find` typed its second
   parameter as `{ context: { isSystem?: boolean } }`, omitting the `where`
   field the real call site (`knowledge-service.ts`'s RLS re-check) actually
   passes. `expect(opts.where).toEqual(...)` then read a property TypeScript
   correctly said did not exist (TS2339). Fixed by widening the mock's
   parameter type to match the call it stubs (`where` and `fields` added),
   not by loosening the assertion.
3 & 4. Two more `vi.fn()` mocks (`upsertSpy`/`deleteSpy`/`searchSpy` in
   `makeAdapter`, and a `find` mock in the reindex test) had **no** parameter
   type at all, so TypeScript inferred a zero-argument implementation and
   `.mock.calls[N]` was typed as an array of **empty tuples**. Indexing past
   that boundary (`.mock.calls[0][1]`) is a genuine tuple-length error
   (TS2493), and casting the resulting `undefined` onward compounded into
   TS2352. Fixed the reindex-test `find` mock by typing its parameters to
   match the real `reindexSource` call site (`where`, `limit`, `context`);
   the `makeAdapter` stubs were reached only through the 3 TS2835 (below) and
   needed no change of their own once those were fixed.

**The three TS2835 are repaired directly** (`.js` added to three relative
specifiers in the test files), not routed around by excluding tests from
`tsconfig.json` — which stays exactly as it is, per the family's own rule
(AGENTS.md: never add such an exclusion). Because this package's build config
already includes the tests, its `typecheck` script's own `tsc --noEmit tsconfig.json`
step reads these same files under NodeNext regardless of the new sibling
config, so they needed fixing either way — unlike `service-cluster`, whose test
files already carried the extension and needed no import repair.

Wired by the #14062 / #5286 route: `tsconfig.test.json` named by a new
`typecheck` script through the shared `check:test-typecheck` gate. No
`test-typecheck-debt.json` is added — its **absence is the zero**: the gate
reads a missing ledger as no entries, under which any error in any file here
is immediately red. After the repair, **both** readings (`tsconfig.json` and
`tsconfig.test.json`) are 0.

The package's `DEBT` entry in `scripts/check-type-check-coverage.mjs`
(`errors: 10`) is **deleted**, not lowered — the graduation the ratchet's own
invariant requires. `scripts/check-type-source-resolution.mjs` gains a
registry entry for the three workspace deps (`core`, `objectql`, `spec`) now
reached only through the new `tsconfig.test.json` program (the #11490
onboarding-limb re-baseline, same route `service-cluster` took): `paths` was
measured and rejected — redirecting those three deps to source takes this
package's test layer from 0 errors to 487, all TS6059, all in another
package's source.

No runtime code changes: `src/**` (excluding tests) is byte-identical, so no
shipped behaviour moves. The `patch` level reflects the published
`package.json` gaining `typecheck` / `check:test-typecheck` scripts and a
`tsx` devDependency.
