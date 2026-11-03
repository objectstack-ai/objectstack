---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `os explain` no longer tells a Modify All holder that a row-conditioned field lock binds

Clause-②: yes (widening)
Metadata-protocol: none

The access explanation's field-level layer listed every field permission that carries a `when` as "judged per row by the write gate, applied as the lock everywhere else". For a caller whose permission sets hold Modify All Data on the object, that was untrue: the field merge applies the Modify All vote after the per-entry votes, under every `when` verdict, so such a lock binds on no row (ruling of record 6573563853, letter A). The explanation now lists those entries separately, as superseded by the Modify All Data field vote and naming the sets that hold it. A View All holder, and a caller who holds neither, keeps the row-conditioned sentence as before, because their edit lock still binds per row.

Enforcement is unchanged. `PermissionEvaluator.conditionedFieldEntries` now names each entry's superseding sets in a new `supersededBy` member, read from the same `superuserFieldVote` that `getFieldPermissions` applies.
