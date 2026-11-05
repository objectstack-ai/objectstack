---
'@objectstack/objectql': patch
'@objectstack/plugin-security': patch
'@objectstack/verify': patch
---

fix(objectql)!: a non-system write may name, in a `lookup` or `user` field, only a record the caller can read (#29029)

Clause-②: yes (narrowing) — the write's reference check narrows: a non-system `lookup` or `user` value naming a record the caller cannot read is refused. The business-unit read widens: a delegated admin reads the business units inside the admin scope it holds, and no other.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. The refusal is the engine's own localized reference_not_found, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the write's reference check (`@objectstack/objectql`), served by every write door.

After the upgrade, an insert or update that is not a system write is refused with `400 VALIDATION_FAILED` and the field's localized `reference_not_found` when a `lookup` or `user` value it supplies names a record the caller cannot read, before the record's validation rules run.

A delegated admin whose admin scope covers a business-unit subtree can read the business units in that subtree, and no business unit outside it (`@objectstack/plugin-security`).

The parent-write-reach verifier's personas read every record of each object a probed detail's required reference names outside its master chain, so the create probe names records its writer reads (`@objectstack/verify`).
