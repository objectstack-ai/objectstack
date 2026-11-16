---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a computed field over a field the caller cannot read is hidden from that caller

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `skills/objectstack-data` teaches a rate as a `formula` over a `summary` and tells an author to mask the summary on a set that must not see it; that instruction is now complete as written, because the formula over the masked summary is withheld with it, so no page needs a new sentence.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped, and no stored row changes: what moves is which computed fields the field-level security read mask and query guard withhold from a caller, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller who is not served whole a field that a computed field reads. Field-level security now covers what a field's value is computed from: a computed field — a `formula`, computed on read, or a stored field declaring an `expression`, computed on write — is withheld from a caller who is not served whole a field it reads:

- a field of its own record the caller may not read (a permission set marks it `readable: false`, or the caller fails its `requiredPermissions`) or is served masked (its `maskingRule`), whether the expression names it directly, inside a function such as `label()`, or through another computed field;
- a field the referenced object declares, on the record the expression reads through one reference, where the caller may not read that object, may not read the field (`readable: false`, or a failed `requiredPermissions`) or is served it masked, directly or through a formula of the referenced object.

What is judged is the field, not the row: a computed field is not withheld because the caller may not read the particular record a reference points at. A formula reads `null` there, as before; a stored computed field keeps the value its writer computed.

Who moves:

- a holder of a permission set that withholds such a field, who read a computed field over it. That includes a View All / Modify All holder over a field whose `requiredPermissions` capability it does not hold, or that it is served masked: the vote lifts a permission set's `readable: false`, not a capability gate or a masking rule;
- every caller but a system context, for a computed field over a field whose `maskingRule` declares no unmask gate (no `requiredPermissions`): that field is served masked to every such caller;
- a delegate acting on behalf of a delegator who is not served such a field whole;
- every public-form submitter: the record the engine echoes for a public-form grant carries no computed field that reads through a reference, whatever the submitter could read there (the form submit route itself answers the created id only);
- a caller who reads a computed field whose expression reads the record in a way no field name describes (a computed member key, a method or macro on the record, the record handed whole to a function, a dialect other than CEL), while some other field of the object is not served whole to that caller.

For that caller, after this release, the computed field is withheld exactly as the field it reads is:

- `find` / `findOne`, a projection naming it, and the record an `insert` / `update` echoes back carry no key for it. Before, a computed field over a field of its own record was served with its value; a stored one reading through a reference, with the value its writer computed; a formula reading through a reference, with `null` where the field there was not readable, and computed over the masked value where it was served masked.
- filtering, sorting, grouping or aggregating by a stored computed field over such a field is refused `403 PERMISSION_DENIED`. Before, it was admitted. (A `formula` is refused in those positions for every caller, as before.)
- the read projections (`getReadableFields`, `getMetadataReadableFields`, and with them the export header and the object schema the metadata plane and `describe_object` serve), the query projection (`getQueryableFields`), the write projection (`getWritableFields`) and the record field access (`getRecordFieldAccess`, both halves) leave it out; the explain `fls` layer reports it masked from responses.

A field the referenced object does not declare is no field to withhold: a formula naming one reads `null`, as before.

The fix, when the caller should read the computed field: grant the caller's permission set read on every field the computed field reads, and on the object a reference reads through, unmasked — the capability a field's `requiredPermissions` names, which also lifts a `maskingRule` gated by it. A field whose `maskingRule` declares no gate is masked for every caller; to make it readable whole, give the field `requiredPermissions` (the capability then unmasks it) and grant that capability. When the caller should not read the computed field, nothing is owed.

Unchanged: a computed field over fields the caller is served whole is served and listed as before; a system context reads every field and every computed field; a View All / Modify All holder reads a field a permission set marks `readable: false` and the computed fields over it, as before; a caller holding several permission sets reads a computed field when any set grants read on its inputs; the aggregate refusal of a field the caller cannot read is as before.
