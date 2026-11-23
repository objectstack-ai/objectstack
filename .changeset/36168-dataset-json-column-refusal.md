---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the dataset query door, `POST /api/v1/analytics/query` and the native arm of `POST /api/v1/analytics/sql` refuse `=`, `$in` and every other scalar comparison or text operator on a multi-value or JSON field with the data door's `400 INVALID_FILTER`, instead of answering a wrong count

Clause-②: no (narrowing) — the dataset query door, `POST /api/v1/analytics/query` and the native SQL arm of `POST /api/v1/analytics/sql` refuse a scalar comparison on a multi-value or JSON field, in a `where` or a `timeDimensions[].dateRange` window, that they answered `200`
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer to a request: a filter the data door already refuses is now refused on the analytics dataset door, `POST /api/v1/analytics/query` and the native arm of `POST /api/v1/analytics/sql` too, so there is no stored row, registry key or authored value for a migration to rewrite and no tombstone. -->

**BREAKING** for a client of `POST /api/v1/analytics/dataset/query` (and every other caller of the dataset query on the native SQL strategy or the draft preview) whose `runtimeFilter`, dataset `filter` or measure `filter`, and for a client of `POST /api/v1/analytics/query` or of `POST /api/v1/analytics/sql` answered by the native SQL strategy whose `where`, applies an operator of `JSON_COLUMN_INCOMPATIBLE_OPERATORS` (`@objectstack/core`) — `$eq` or implicit equality, `$ne`, `$in`, `$nin`, `$gt` / `$gte` / `$lt` / `$lte`, `$between`, `$startsWith`, `$endsWith`, `$icontains` — to a multi-value or JSON field: an inherently multi-value type (`tags`, `multiselect`, `checkboxes`), a `select`, `radio`, `lookup`, `user`, `file` or `image` field declared `multiple: true`, or a structured-JSON type. The same holds on all three doors, when the native SQL strategy answers, for a `timeDimensions[].dateRange` window on such a field (the dataset door's `selection.timeDimensions[]` included), which compiles to a `$gte` / `$lte` pair:

- FROM: the native SQL strategy compared the stored JSON text (`["a","b"]`) against the comparand and answered `200`: `$in` / `$eq` counted no row, `$nin` / `$ne` counted the rows they were asked to exclude, and the orderings and the text operators matched the serialization. The draft preview (`?preview=draft`) gave the same counts over the drafted rows. TO: `400 INVALID_FILTER` before anything runs, in the words `POST /api/v1/data/:object/query` answers, naming the field and the operator, on every dialect. The ObjectQL strategy already answered this. On a datasource whose SQL dialect the host cannot name (memory, MongoDB), the native strategy now declines a query whose `where`, dataset `filter`, measure `filter` or read scope carries such a comparison, so the engine answers it through its own driver; a `timeDimensions[].dateRange` window on such a field is not part of that decline, and is refused `400 INVALID_FILTER` on every datasource the native strategy compiles for.

**Not moved.** `$contains` / `$notContains` (membership), `$null`, `$exists` and `$empty` on such a field, `$eq: null` / `$ne: null` (a null predicate), an empty `$in` / `$nin`, and every operator on a scalar field answer as before.

The fix for a caller: write `{ "FIELD": { "$contains": "a" } }` for membership, an `$or` of `$contains` for any-of, and `$null` / `$empty` for no value.
