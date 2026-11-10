---
'@objectstack/plugin-security': patch
'@objectstack/core': patch
---

fix(plugin-security, core)!: a transfer is explained, and hinted to the client, only where the record can be edited and its owner changed

Clause-②: yes (narrowing) — `security.explain` with `operation: 'transfer'` and the `allowTransfer` bit of the `/me/permissions` `objects` map (the same map `current_user.can(object, 'transfer')` reads) now answer edit and the transfer grant together, at the object and the record level, on every object.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: `allowTransfer` keeps its meaning as authored, and what moves is the answer two readers compute from it. Nothing at rest records that answer, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING.** A transfer is an update of a record's owner, so it needs edit (which implies read) as well as the transfer grant (`allowTransfer`, or `modifyAllRecords`, which grants both). Two readers now give that answer (ruling of record 6755714726, ADR-0142 as amended):

- `security.explain` for `operation: 'transfer'`: the `object_crud` layer grants it only where the principal's sets grant edit and the transfer grant; edit from one set and the transfer grant from another compose, and the layer names both. The record-grained verdict follows.
- `/me/permissions`: an entry's `allowTransfer` reads `true` only where the entry grants edit, on every object — not only on the managed objects whose write guard already required it.

Enforcement is unchanged: the transfer grant is what admits an update of `owner_id` beside edit, and an insert that names another owner (create-and-assign) is admitted by the transfer grant without edit.

What to do: a permission set meant to let its holders reassign records grants `allowRead`, `allowEdit` and `allowTransfer` together. A client or a formula that read `allowTransfer` (or `can(object, 'transfer')`) for a principal holding the transfer grant without edit now reads `false`; if it used that answer to offer creating a record for another owner, the server admits that insert, and the offer needs its own reading of the principal's permission sets.
