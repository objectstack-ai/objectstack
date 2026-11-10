---
'@objectstack/plugin-security': patch
'@objectstack/core': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/spec': patch
---

fix(plugin-security, core)!: a transfer is explained, and hinted to the client, only where the record can be edited and its owner changed

Clause-②: yes (narrowing) — `security.explain` with `operation: 'transfer'` and the `allowTransfer` bit of the `objects` map `/me/permissions` serves now answer edit and the transfer grant together, at the object and the record level, on every object.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export is removed or retyped (`@objectstack/core` adds `servedObjectPermissions`): `allowTransfer` keeps its meaning as authored, and what moves is the answer two readers compute from it. Nothing at rest records that answer, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING.** A transfer is an update of a record's owner, so it needs edit (which implies read) as well as the transfer grant (`allowTransfer`, or `modifyAllRecords`, which grants both). Two readers now give that answer (ruling of record 6755714726, ADR-0142 as amended):

- `security.explain` for `operation: 'transfer'`: the `object_crud` layer grants it only where the principal's sets grant edit and the transfer grant; edit from one set and the transfer grant from another compose, and the layer names both. The record-grained verdict follows.
- `/me/permissions`: an entry's `allowTransfer` reads `true` only where the entry grants edit, on every object — not only on the managed objects whose write guard already required it. The served slot is derived from the one effective map by that clamp alone (`servedObjectPermissions`, `@objectstack/core`).

Enforcement is unchanged: the transfer grant is what admits an update of `owner_id` beside edit, and an insert that names another owner (create-and-assign) is admitted by the transfer grant without edit. `current_user.can(object, 'transfer')` evaluated on the server is unchanged: it reads the transfer grant. A predicate the Console evaluates reads the served hint, so for a principal holding the transfer grant without edit a client-evaluated `current_user.can(object, 'transfer')` answers `false`.

What to do: a permission set meant to let its holders reassign records grants `allowRead`, `allowEdit` and `allowTransfer` together. A client that read the served `allowTransfer` for a principal holding the transfer grant without edit now reads `false`. An author who gated an assign-on-create offer (an option's `visibleWhen`, for instance) on `current_user.can(object, 'transfer')` sees the Console withhold that offer from such a principal, while the server still admits the insert; to offer it there, grant edit beside the transfer grant.
