---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a computed field over a field the caller cannot read is hidden from that caller

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `skills/objectstack-data` teaches a rate as a `formula` over a `summary` and tells an author to mask the summary on a set that must not see it; that instruction is now complete as written, because the formula over the masked summary is withheld with it, so no page needs a new sentence.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped, and no stored row changes: what moves is which computed fields the field-level security read mask and query guard withhold from a caller, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller whose permission sets hide a field that a computed field reads. Field-level security now covers what a field's value is computed from: a caller who cannot read a field, or is served it only partially masked, cannot read any computed field — a `formula`, or a stored field declaring an `expression` — whose expression reads that field, directly or through another computed field. The computed field is withheld exactly as the field it reads is.

Who moves: a role that read such a computed field — a role whose set marks a field `readable: false`, or that fails a field's `requiredPermissions`, or is served a field under its `maskingRule`, and that read a computed field over that field.

What moves (each line FROM → TO):

- `find` / `findOne`, and the record an `insert` / `update` echoes back, for that caller: FROM the computed field served with its value TO the key absent, as the field it reads is.
- the same caller filtering by, or aggregating, a stored computed field over such a field: FROM admitted TO refused `403 PERMISSION_DENIED`, as filtering by or aggregating the field it reads already is; `getQueryableFields` no longer lists it for that caller.
- a computed field over a field the caller is served partially masked: FROM served in full TO absent; a mask written for the field it reads does not describe the value computed from it.
- a computed field whose reads cannot be named from its expression (a computed member key, a method or macro on the record, the record handed whole to a function, a dialect other than CEL): withheld whenever the caller may not read some other field of the object.

The fix, when the role should read the computed field: grant the role read on every field the computed field reads (or the capability its `requiredPermissions` names). When it should not, nothing is owed.

Unchanged: a computed field over fields the caller may read is served as before; a system context and a View All / Modify All holder read every field and every computed field; the aggregate refusal of a field the caller cannot read is as before; the readable-field projection (`getReadableFields`, and the object schema the metadata plane serves from it) still lists the computed field, whose rows now carry no value for it.
