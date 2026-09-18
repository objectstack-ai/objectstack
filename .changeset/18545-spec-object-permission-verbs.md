---
'@objectstack/spec': minor
---

Publish the object-permission VERB vocabulary and the effective-entry reader from `@objectstack/spec/security`.

`Clause-②: yes` — new exported names on a published surface. Purely additive: no export is removed, renamed or narrowed, and no schema changes shape.

**New exports**

- `OBJECT_PERMISSION_VERBS` — the closed verb → `allow*` bit table. Derived from the bare verbs of the object-permission key aliases (`read`, `create`, `edit`/`update`/`write`, `delete`/`remove`, `export`, `transfer`) plus one row that is not derivable and is recorded as a deliberate choice: `import` → `allowCreate`, because importing rows is creating rows. `restore` / `purge` are absent, as they are on the alias table since their bits were retired.
- `OBJECT_PERMISSION_VERB_NAMES` — the same vocabulary, sorted, for a refusal message to name in full.
- `resolveObjectPermissionVerb(verb)` — the only supported read of the table. Use it rather than indexing the record: a direct index answers `toString` with a function, which a truthiness check reads as a grant.
- `objectPermissionGrants(permission, target)` — whether one `EffectiveObjectPermission` entry grants a bit, folded the way the enforcement path folds it: `viewAllRecords` or `modifyAllRecords` grants read; `modifyAllRecords` grants edit, delete and transfer but never create; `export` is `grant ∧ read`. An absent entry and an all-`false` entry both answer `false`.
- `ObjectPermissionVerbTarget` — the `allow*` bit type a verb can resolve to.

**Why they are published**: `@objectstack/formula`'s new `current_user.can(object, verb)` predicate reads a `/auth/me/permissions` map, and a client rendering the same capability reads the same map. One table and one fold, published once, so the predicate an author writes and the 403 the server returns cannot answer differently.
