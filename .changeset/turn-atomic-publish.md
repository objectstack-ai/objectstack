---
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
---

Package-draft publishing is now turn-atomic (ADR-0067 Decision-2, #3066). `publishPackageDrafts` runs every draft promotion AND the `sys_metadata_commit` record inside ONE engine transaction — a mid-batch failure rolls back the whole batch (`publishedCount: 0`; the causal item carries its real error, the rest report `batch_aborted`). Side effects (registry refresh, table DDL, seed apply, materializers, ADR-0094 projections, events) run after the metadata commits and are surfaced-not-swallowed on failure. `@objectstack/objectql`'s `engine.transaction()` now JOINS an already-open ambient transaction instead of opening a nested driver transaction (deadlock on single-connection pools; escaped the outer rollback). BREAKING (behavioral): API consumers that relied on partial batch publishes ("2 of 3 landed") now get all-or-nothing; engines without `transaction()` (memory driver, minimal stubs) keep the previous sequential behavior.
