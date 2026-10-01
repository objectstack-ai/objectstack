---
'@objectstack/plugin-audit': minor
---

fix(plugin-audit)!: an engine read of `sys_activity` returns only the rows whose parent record the caller can read, the same way an engine read of `sys_comment` is narrowed

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a narrowing of what a READ returns, on one platform object, decided at request time: an activity row is served to a caller exactly when the record it names (object_name, record_id) is one that caller can read. No authorable key, spelling, value domain, export or stored metadata shape moves: the sys_activity object definition is byte-identical, every query shape parses as before, the package barrel exports nothing new and nothing less, and no stored row is rewritten. There is therefore nothing for an author to convert and nothing for `objectstack migrate meta` to reach. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a read-visibility rule and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a published TypeScript declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows what an engine read of `sys_activity` returns to a caller that is not system context. It ships as `minor` under the repo's launch-window convention for narrowings.

**What changes.** `AuditPlugin` now mounts a read gate on `sys_activity`, beside the one `sys_comment` already has. It is an engine middleware, so it narrows what passes through the engine: `find`, `findOne`, `count` and `aggregate`, which on the generic data doors are the list, its `total`, the by-id read and both query shapes. There a row is returned only when the caller can read the record it is about. That answer is the one the comment gate asks: the caller's own engine read of the parent record, so the parent object's sharing, RLS and object-level permissions decide. Parent reads are batched, one per parent object.

**Rows that are left out**, failing closed exactly as the comment gate does for its threads:

- a row about a record the caller cannot read;
- a row about a record that no longer exists;
- a row that names no record, or names an object the engine does not know;
- a row that names `sys_activity` itself.

**Unchanged.** A caller who can read every record (an admin) keeps every row about a record that exists. System-context reads, including the audit writer's own, are not narrowed. The object, its fields and what the CRUD mirror writes are unchanged, and nothing stored is rewritten.
