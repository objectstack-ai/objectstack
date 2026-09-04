---
"@objectstack/service-storage": patch
---

fix(service-storage): put the test layer in front of tsc, and repair what it was hiding (#15050)

`packages/services/service-storage` had **no `typecheck` script at all** — its
scripts were `build` and `test` — so no tsc program anywhere read this
package's test layer, and its errors were carried instead as a 51-error DEBT
entry in `scripts/check-type-check-coverage.mjs`. Gives it the #14062 /
#14181 "checked test zone" shape: a sibling `tsconfig.test.json` (module
semantics only — `esnext` / `bundler` / `lib: ES2022` — matching how vitest
actually executes these files; strictness inherited and untouched) plus a
`tsconfig.scripts.json` for `scripts/i18n-extract.config.ts` (the ninth
instance of #11351, previously excluded from that ledger only because this
package had no `typecheck` script to hang it on), both named by a new
`typecheck` script.

Measured before repair: 51 errors under BUILD semantics (`tsc --noEmit -p
tsconfig.json`, which already includes the tests — matching the DEBT entry's
recorded number exactly), 10 under the split. Unlike `service-cluster`
(#14181), this package's BUILD reading was *not* already clean, so both
programs needed genuine repair, not just the test-only split: 23 `TS2835`
(relative imports missing their `.js` extension, required under BUILD's
NodeNext resolution) were fixed by *adding* the extension — which resolves
correctly under both NodeNext and the split's bundler mode — and clearing
that also cleared all 15 `TS7006` "implicitly any" as a downstream cascade
from the same unresolved imports (the shape `@objectstack/core` reported at
98 → 4). The remaining 3 `TS2550` (`Array.prototype.at` needing `lib`
es2022) are rewritten to indexed access rather than widening the shared
BUILD `tsconfig.json`. The 8 code-tier errors (`TS2339` × 4 — a test
helper's object-spread dropped its `Record<string, unknown>` index
signature, fixed with an explicit return-shape annotation; `TS2347` × 4 — a
fake `ctx: any`'s `getService<T>(...)` calls converted to `getService(...)
as T`, the pattern one call site in the same file had already adopted for
exactly this reason) are genuine test-file fixes. Both readings now agree at
0/0 — the same result `service-cluster` reported, reached by a longer road.

The package's DEBT entry (51 errors) is **deleted**, not lowered — the
graduation this ratchet's invariant requires. No `test-typecheck-debt.json`
is added: residue is 0, so none is owed (#5286, maintainer-only to open).
`check:type-source-resolution` went red from onboarding the two new
programs (the documented onboarding-limb case): a registry entry is added
rather than `paths`, measured both ways — `paths` takes this package's test
layer from 0 errors to 306, all in other packages' source.

No runtime code changes: `src/**` excluding tests is byte-identical, so no
shipped behaviour moves. The `patch` level reflects the published
`package.json` gaining `typecheck` / `check:test-typecheck` scripts and a
`tsx` devDependency.
