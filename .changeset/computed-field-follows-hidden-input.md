---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a computed field over a field the caller cannot read is hidden from that caller

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `skills/objectstack-data` teaches a rate as a `formula` over a `summary` and tells an author to mask the summary on a set that must not see it; that instruction is now complete as written, because the formula over the masked summary is withheld with it, so no page needs a new sentence.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped, and no stored row changes: what moves is which computed fields the field-level security read mask and query guard withhold from a caller, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller whose permission sets withhold a field that a computed field reads. Field-level security now covers what a field's value is computed from: a computed field — a `formula`, or a stored field declaring an `expression` — is withheld from a caller who is not served whole a field it reads:

- a field of its own record the caller may not read (a permission set marks it `readable: false`, or the caller fails its `requiredPermissions`) or is served masked (its `maskingRule`), whether the expression names it directly, inside a function such as `label()`, or through another computed field;
- a field the referenced object declares, on the record the expression reads through one reference, that the caller may not read or is served masked there, directly or through a formula of the referenced object.

Who moves:

- a holder of a permission set that withholds such a field, who read a computed field over it;
- a delegate acting on behalf of a delegator whose permission sets withhold such a field;
- every public-form submitter: the record echoed back to the submitter carries no computed field that reads through a reference, whatever the submitter could read there;
- a caller who reads a computed field whose expression reads the record in a way no field name describes (a computed member key, a method or macro on the record, the record handed whole to a function, a dialect other than CEL), while some other field of the object is not served whole to that caller.

For that caller, after this release, the computed field is withheld exactly as the field it reads is:

- `find` / `findOne`, a projection naming it, and the record an `insert` / `update` echoes back carry no key for it. Before, it was served with its value.
- filtering, sorting, grouping or aggregating by a stored computed field over such a field is refused `403 PERMISSION_DENIED`. Before, it was admitted. (A `formula` is refused in those positions for every caller, as before.)
- the read projection (`getReadableFields`, and with it the export header and the object schema the metadata plane and `describe_object` serve) and the query projection (`getQueryableFields`) leave it out; the explain `fls` layer reports it masked from responses.

A field the referenced object does not declare is no field to withhold: a formula naming one reads `null`, as before.

The fix, when the caller should read the computed field: grant the caller's permission set read on every field the computed field reads, unmasked (the capability a field's `requiredPermissions` names, or the one that lifts its `maskingRule`). When it should not, nothing is owed.

Unchanged: a computed field over fields the caller is served whole is served and listed as before; a system context and a View All / Modify All holder read every field and every computed field; a caller holding several permission sets reads a computed field when any set grants read on its inputs; the aggregate refusal of a field the caller cannot read is as before.
