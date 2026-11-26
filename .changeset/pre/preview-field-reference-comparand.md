---
'@objectstack/service-analytics': patch
---

Clause-②: no
Metadata-protocol: none

The analytics draft preview (`queryDataset` with `previewDrafts`, the face Studio's preview mode reads) now resolves a `{ $field }` comparand the way the published dataset does. A comparison between two scalar columns of the row (`{ label: { $eq: { $field: 'alias' } } }`, and `$ne` / `$gt` / `$gte` / `$lt` / `$lte`) compares the two columns, with the same answer for empty values as the live faces (both empty is equal). A reference the live faces refuse is refused with their `INVALID_FILTER` / 400: a multi-value, JSON, file or formula column on either side, two columns of different comparison classes, an undeclared column, a dotted path, and a reference in an `$in` / `$nin` list or under a text-pattern operator. Before, the preview compared the row value with the reference object as text, so every field-to-field filter showed a wrong count with no error, and the count changed at publish.

One shape is refused on the preview although the published dataset serves it: a reference with an `addDays` offset (`{ $field: 'due_on', addDays: 3 }`). The preview refuses it by name rather than evaluate the day shift differently; publish the draft to chart it.
