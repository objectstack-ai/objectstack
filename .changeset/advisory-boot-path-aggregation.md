---
"@objectstack/core": minor
"@objectstack/objectql": minor
"@objectstack/metadata-protocol": minor
---

Advisory validation rules no longer flood the startup log, and no longer count a row twice on a clean first boot.

A `severity: 'warning'` (or `'info'`) validation rule is advisory: it never blocks a write, and its message is written for a person filling in a form. Evaluated across a seed load it produced one `WARN` line per row, so a clean-database first boot opened with a wall of form hints re-cast as boot diagnostics — and an app could reach "zero warnings" only by bending its data or deleting the rule.

Two changes, and neither moves what a rule evaluates to:

- **Aggregated reporting on the seed/boot path.** `SeedLoaderService.load()` now runs inside an advisory aggregation scope, and reports one summary line per rule — the rule, the object, the row count, the rule's own message and example rows — instead of one line per row. Off that path (an ordinary interactive write) nothing changes: the same per-write line is emitted verbatim. The new scope is `runWithAdvisoryAggregation` / `recordAdvisoryHit` in `@objectstack/core`.
- **Advisory rules are counted by row, not by write.** An `update` whose payload touches only platform-injected system columns — the shape `claimSeedOwnership` writes when it hands seeded rows to the first admin, `{ owner_id }` — changes no business field, so it no longer re-evaluates the object's advisory rules. Previously a seeded row rang once on insert and again when the claim scan rewrote `owner_id`, so anyone counting startup warnings over-estimated by the number of claimed objects.

`error`-severity rules are untouched by both changes: an invariant is still enforced on every write, whoever issued it and however little it moved. Membership of the "system column" set is resolved per object by `resolveInjectedSystemColumns`, so an object that declares `ownership: 'org'` (no `owner_id`) or `systemFields: false` is judged on its own columns rather than a fixed list.
