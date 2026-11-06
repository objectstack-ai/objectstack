---
'@objectstack/objectql': patch
'@objectstack/service-analytics': patch
---

fix(objectql, service-analytics)!: a plain group over a formula field is refused alike on every analytics face, instead of a 500, a driver backstop, one null group or a rendered statement

Clause-②: no (narrowing) — `engine.aggregate` now refuses `INVALID_FIELD` / 400 a `groupBy` entry of any form (a name, `{ field }`, or a bucket) naming a virtual (`formula`) field, whatever its `returnType`, before any driver is asked: at `groupBy.N` for a name, `groupBy.N.field` for the object form, and `groupBy.N.dateGranularity` for a bucket, as before. `/analytics/query` on the native composition, `/analytics/sql` (`AnalyticsService.generateSql`), the draft preview of `queryDataset` and the delegated fallback face give the same refusal, field for field. Nothing is widened: no export of either package root, public member, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of either package root changes: a query that grouped by a column the table does not store is refused before it reaches the driver, with an error code and status already on the wire. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on `engine.aggregate` (`@objectstack/objectql`) and on every analytics face (`@objectstack/service-analytics`), for a plain group over a `formula` field only.

- **Before.** Measured on `main` `447226b2` with a real `SqlDriver`, a dataset or cube dimension over a `formula` (`returnType` `date` or `text`). `/analytics/query` on the native composition answered `DATABASE_ERROR` / 500 (the native strategy ran `GROUP BY calc` itself); on the ObjectQL composition it answered the SQL driver's missing-column backstop, `INVALID_FIELD` / 400 with no `path` and a "run schema sync" prescription that cannot help. The `/analytics/sql` dry run rendered `SELECT calc AS "calc" … GROUP BY calc` on both compositions, and the draft preview served one `null` group holding the total. `engine.aggregate` on a driver with no native `aggregate` (the in-memory aggregation) served one `null` group holding every row.
- **Now.** The engine's aggregate door gains a storage axis (`assertGroupByTargetsAreStored`, ahead of the date-bucket door), judged by the spec's `isVirtualSearchField` (`SEARCH_VIRTUAL_TYPES`), the predicate the sort, filter, search and bucket axes already refuse a formula by. The service's copy (`dataset-date-bucket-door.ts`, `assertDatasetGroupTargetsStored`) gives the same refusal on the faces that hand the engine no keys: the dry run, the preview and the delegated fallback service. The native-SQL strategy declines a query whose `dimensions` entry resolves to a virtual field, so that query reaches the engine. A dimension through a relationship (`account.calc`) over a related object's formula is judged on the keys the cross-object path hands the related object, on the query and the dry run alike, whether or not a base row exists.
- **Unchanged.** A plain group over a stored field, and a date or datetime bucket, are served on every face, byte for byte, and stay on the native strategy where they were. A measure-only query stays native. The #29167 refusal of a bucket over a formula keeps its words and position.
- **Who moves.** A caller grouping by a formula field: a located refusal with a remedy, instead of a 500, a backstop with the wrong advice, an empty-looking group or SQL for a statement that never runs.

**The remedy.** Denormalise the value onto the object (a stored field, written when the source changes) and group by that.
