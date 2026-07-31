---
---

ci(dx): every workspace package now either declares a `typecheck` script (`tsc --noEmit`, run by the new `turbo run typecheck` task in the lint workflow) or carries a measured DEBT/EXEMPT entry in `scripts/check-type-check-coverage.mjs`, whose coverage ratchet runs in CI (#4311). 66 of 77 packages build with tsup, which transpiles without type-checking, and `vitest run` does not type-check either — 48 packages were already clean and are locked in; the 29 failing ones are frozen in the ledger with their raw error counts and the issue's code/config/noise triage. Dev scripts and CI only; releases nothing.
