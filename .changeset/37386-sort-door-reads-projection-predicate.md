---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): the Data API's sort door judges a computed field type by the predicate the sortability projection reads

Clause-②: no
Metadata-protocol: none

`GET /data/:object?sort=<field>` and every other sort that reaches `findData` refuse an order by a field whose type is computed on read (`400 INVALID_SORT`). The door decided "computed on read" from a set of its own, `formula` alone. The sortability projection served on `GET /meta/object/:name` (`resolveObjectSortability`, `reason: 'virtual-type'`) decided the same thing from `@objectstack/spec/data`'s `isVirtualSearchField`. The door now reads that predicate too, as its filter and search checks already did, so one place answers which field types have no column to order by.

Nothing changes for a caller: both sets held `formula` and nothing else, so every sort is accepted or refused as before, with the same code, status and message. What changes is what happens when a computed type is added: it is added in the spec's `SEARCH_VIRTUAL_TYPES`, and the Data API door, the projection, the list header and the Sort picker follow together. Before, a type added to one set alone left the grid offering a sort the Data API refused, or the Data API refusing a computed type in the words it uses for a field that declares `sortable: false`.

What to do: nothing.
