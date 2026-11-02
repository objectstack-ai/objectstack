---
'@objectstack/objectql': patch
---

fix(objectql)!: a non-system write may name, in a `lookup` or `user` field, only a record the caller can read (#29029)

Clause-②: yes (narrowing) — a non-system write whose `lookup` or `user` value names a record the caller's own read door does not return is refused with `reference_not_found`, which it admitted before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the reference check the write already runs for a master_detail header now runs for lookup and user values too. The refusal is the engine's own localized reference_not_found, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the write's reference check (`@objectstack/objectql`), served by every write door (REST, MCP, flows run as the user, `ctx.api` in hooks).

After the upgrade, an insert or update that carries no `isSystem` is refused when a `lookup` or `user` value it supplies names a record the caller cannot read: the answer is `400 VALIDATION_FAILED` with the field's `reference_not_found`, localized, exactly the answer for a record that exists nowhere. This is the rule `master_detail` already follows.

- **Each value is judged.** A multi-valued `lookup` or `user` field is refused when any one of its values names a record the caller cannot read.
- **Unchanged.** System writes (`isSystem`: seed replay, boot, package install) stay exempt, as before; a flow run's elevated write keeps its existence check. An update that carries back a value the row already stores is not judged again. An empty value is not a reference. A `readonly` field is not the caller's to answer for. A `tree` parent keeps the existence check alone.
- **Who sees it.** An app whose users write a reference to a record their own access does not return. A user can still reference every record they can read.

**The remedy.** None for an app that meant its read access as the boundary. An app that wrote its own `beforeInsert` / `beforeUpdate` hook to refuse a reference to an unreadable record can delete it: the engine now refuses it, localized. A flow that must link records the acting user cannot read runs with `runAs: 'system'`.
