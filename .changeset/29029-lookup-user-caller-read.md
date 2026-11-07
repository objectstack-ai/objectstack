---
'@objectstack/objectql': patch
'@objectstack/plugin-security': patch
'@objectstack/verify': patch
---

fix(objectql)!: a non-system write may name, in a `lookup` or `user` field, only a record the caller can read (#29029)

Clause-②: yes (narrowing) — the write's reference check narrows: a non-system `lookup` or `user` value naming a record the caller cannot read is refused, and an update's forgiveness of a value the row already stores compares only stored values the caller may read. The business-unit read widens: a delegated admin reads the business units inside the admin scope it holds, and no other.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. The refusal is the engine's own localized reference_not_found, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the write's reference check (`@objectstack/objectql`), served by every write door.

After the upgrade, an insert or update that is not a system write is refused with `400 VALIDATION_FAILED` and the field's localized `reference_not_found` when a `lookup` or `user` value it supplies names a record the caller cannot read, before the record's validation rules run.

An update that carries back a `lookup`, `master_detail` or `user` value the row already stores is still not judged again, but that comparison reads only stored values the caller may read, by id and in bulk alike. In a column the caller may edit but not read (a field permission `{ readable: false, editable: true }`), every value is judged as new: one naming a record the caller cannot read is refused with `reference_not_found` even when the row already stores it. A caller who can read the column keeps the forgiveness, and a system write is unchanged.

A delegated admin whose admin scope covers a business-unit subtree can read the business units in that subtree, and no business unit outside it (`@objectstack/plugin-security`).

The parent-write-reach verifier's personas read every record of each object a probed detail's required reference names outside its master chain, so the create probe names records its writer reads (`@objectstack/verify`).
