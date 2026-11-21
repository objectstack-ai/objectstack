---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the dataset query door refuses `=`, `$in` and every other scalar comparison or text operator on a multi-value or JSON field with the data door's `400 INVALID_FILTER`, instead of answering a wrong count

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer to a request: a filter the data door already refuses is now refused on the analytics dataset door too, so there is no stored row, registry key or authored value for a migration to rewrite and no tombstone. -->

**BREAKING** for a client of `POST /api/v1/analytics/dataset/query` (and every other caller of the dataset query on the native SQL strategy or the draft preview) whose `runtimeFilter`, dataset `filter` or measure `filter` applies an operator of `JSON_COLUMN_INCOMPATIBLE_OPERATORS` (`@objectstack/core`) — `$eq` or implicit equality, `$ne`, `$in`, `$nin`, `$gt` / `$gte` / `$lt` / `$lte`, `$between`, `$startsWith`, `$endsWith`, `$icontains` — to a field declared `multiple: true`, an inherently multi-value type (`tags`, `multiselect`, `checkboxes`) or a structured-JSON type:

- FROM: the native SQL strategy compared the stored JSON text (`["a","b"]`) against the comparand and answered `200`: `$in` / `$eq` counted no row, `$nin` / `$ne` counted the rows they were asked to exclude, and the orderings and the text operators matched the serialization. The draft preview (`?preview=draft`) gave the same counts over the drafted rows. TO: `400 INVALID_FILTER` before anything runs, in the words `POST /api/v1/data/:object/query` answers, naming the field and the operator, on every dialect. The ObjectQL strategy already answered this. On a datasource whose SQL dialect the host cannot name (memory, MongoDB), the native strategy now declines such a query, so the engine answers it through its own driver.

**Not moved.** `$contains` / `$notContains` (membership), `$null`, `$exists` and `$empty` on such a field, `$eq: null` / `$ne: null` (a null predicate), an empty `$in` / `$nin`, and every operator on a scalar field answer as before.

The fix for a caller: write `{ "FIELD": { "$contains": "a" } }` for membership, an `$or` of `$contains` for any-of, and `$null` / `$empty` for no value.
