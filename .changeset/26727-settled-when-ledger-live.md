---
'@objectstack/spec': patch
---

fix(spec): the liveness ledger grades `field.settledWhen` live

Clause-②: no
Metadata-protocol: none

The liveness ledger shipped in `@objectstack/spec` (`liveness/field.json`) graded a deadline field's `settledWhen` as `planned`, with a note saying no reader existed. The console has read it for some time: while the predicate holds for a record, that record's deadline shows no overdue wording and no overdue colour, in the grid, list, gallery, kanban, tree, record detail and approval snapshot. The row is now `live` and names that reader. Nothing about what you can write, or what it does, has changed.

The `dueLike` row's note is corrected the same way: it said the grid did not carry the key yet, and it does.

`object.tenancy` already had correct rows (`tenancy.enabled` and `tenancy.tenantField`, both live), so it is unchanged.
