---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a write from a caller the read door refuses is refused, whatever rows it addresses

Clause-②: no (narrowing) — a predicate update or delete (`multi: true`, addressed by a `where`) from a caller whose read of the object is refused is refused with that read refusal before the write runs, where it was admitted before; nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata an author writes changes and no stored row is rewritten: a runtime write from a caller the object's read refuses is refused -->

**BREAKING** for a caller whose read of an object is refused while its write is admitted, and that updates or deletes that object's records by predicate. With the permission model's own grants that caller exists in one shape only: an object whose `requiredPermissions` map gates `read` and not `update` or `delete` (ADR-0066 ⑤), and a caller holding the write grant without the capability the read requires.

- **The rule.** A caller the read door refuses writes none of the object's records, by id or by predicate. The predicate update and delete such a caller addresses — a flow's `update_record` or `delete_record` node with `multi: true` run as that user, or an engine `update` / `delete` with `multi: true` under that caller's context — now answer the read door's own refusal (the `PERMISSION_DENIED` envelope that caller's read gets), and nothing is written. The by-id update and delete are refused too.
- **Unchanged.** A caller who reads the object keeps its predicate write, scoped to the records it reads. A caller the object's CRUD grants refuse is refused as before. A write the platform issues under the caller's context (a hook's or a cascade's own write, the referential clear of a deleted record's lookups) and a system write keep their answers. A store fault on the read propagates as before.
- **Who moves.** A deployment that relies on such a caller writing by predicate grants it the capability the object's read requires, or gates the write verbs on a capability that caller holds.
