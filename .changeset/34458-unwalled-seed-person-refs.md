---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

Clause-②: no
Metadata-protocol: none

fix(runtime): on an un-walled first boot, a seed person reference naming the first admin resolves to that admin

A single-tenant install loads its boot seed before the first admin's `sys_user` row exists. A `Field.user()` or `Field.lookup('sys_user')` value naming that admin therefore landed NULL, and the first-admin handoff wrote `owner_id` and no other column. Sample records assigned to the owner showed as unassigned, apart from the record owner. A later boot did not repair them either: a dataset in the default create-only mode leaves an existing row as it is.

The seed loader now holds each person reference its second pass left NULL, together with the row it landed on (`SeedLoaderService#resolveHeldPersonReferences`, `heldPersonReferenceCount`). `AppPlugin` retries the boot seed's held references after every `sys_user` insert. It resolves each one by the loader's own rule and writes it to that row only while the column is still NULL. A row the seed did not write keeps its value (ADR-0138 D1). A seeded row that someone assigned in the meantime keeps that assignment. A reference that still names nobody stays held until the next user insert of the process. The walled boot is unchanged: it writes no inline seed, and its per-organization replay already waits for the owner's membership.
