---
'@objectstack/objectql': patch
---

fix(objectql)!: an update compares a value the caller sends only against the stored row as the caller's own read door serves it — a `secret` reference and a master-detail repoint

Clause-②: yes (narrowing) — a non-system update that sends a `secret:` reference is refused even when the record already holds it, and a non-system update naming the master-detail FK of a detail with a parent-scoped `requiredWhen`, in a FK column it may edit but not read, no longer lets a row that already lacks a required value rest under the header it names.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. Both refusals are answers the engine already gives — VALIDATION_ERROR for a secret reference, the field's required finding for requiredWhen — so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at two update seams of `@objectstack/objectql`, served by every write door, by id and in bulk alike. A system write is unchanged at both.

**A `secret` reference.** A non-system update keeps a `secret:` reference only where every record it lands on serves that reference, in that column, to the caller's own read door. The read path serves a `secret` column masked to every caller, so after the upgrade every non-system update that sends a reference is refused with `400 VALIDATION_ERROR` and nothing is written, with one answer whatever the reference names and whatever the column holds — the record's own reference included, which was accepted and kept before. The same holds for a reference a `beforeUpdate` hook writes onto the payload, such as one that spreads the stored row (`ctx.previous`) back into it. To leave a secret unchanged, omit the field or send back the read mask; a hook that writes the stored row back omits its `secret` columns. A new value is still sealed, `null` still clears, and the system principal keeps the pass-through.

**A master-detail repoint.** On a detail whose fields declare a parent-scoped `requiredWhen`, the ADR-0113 pre-check of an update that names the master-detail FK reads the header the row hung off from the stored FK only as the caller's own read door serves it. Where the caller may edit the FK but not read it (a field permission `{ readable: false, editable: true }`), the prior header is unknown to it and is bound as an unresolved one, so the pre-check cannot prove a violation was already stored: a row that already lacks a value its requirement asks for, and that such a caller names a header for, is refused with the field's `required` finding whatever header the row hung off — including the header it already hangs off, which used to rest. A caller who can read the FK is judged as before, and an update that does not name the FK is unchanged.
