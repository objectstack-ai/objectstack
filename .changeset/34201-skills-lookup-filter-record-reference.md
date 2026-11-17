---
'@objectstack/skills': patch
---

docs(skills): `objectstack-data` teaches the `lookupFilters` `{ $record }` reference and `orEmpty`

Clause-②: no
Metadata-protocol: none

objectstack-data's `rules/field-types.md` now teaches a lookup filter that reads the record being edited. A `lookupFilters` value may be `{ $record: 'field' }`, or one lookup hop away, `{ $record: 'lookup_field.field' }` (at most one dot). It is the whole `value`, never a member of an `in` / `notIn` list, and pairs only with `eq`, `ne`, `gt`, `lt`, `gte`, `lte`. Only a record form resolves it; every other picker host leaves the entry out, and while the referenced value is empty the entry is dropped. `orEmpty: true` also matches a candidate whose column is null, with the same six operators. The picker re-queries when a referenced field changes, so that field is not also listed in `dependsOn`, which would add an equality filter on it. The section's example is now a quote's price-book lookup.

Five restatements in the same file are cut to pay for part of it (the `secret` row's recommendation, which the `password` row states; the `autonumber` row's token summary and second format example, which the Autonumber section carries; and two repeats of "pad width is a minimum"). The data-modeling docs pages `relationships.mdx` and `fields.mdx` teach the same four points.
