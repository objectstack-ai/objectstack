---
'@objectstack/objectql': patch
'@objectstack/service-analytics': patch
---

fix(objectql, service-analytics)!: a date bucket over a formula field is refused alike on every analytics face, instead of a driver error, one null group or a rendered statement

Clause-②: no (narrowing) — `engine.aggregate` now refuses `INVALID_FIELD` / 400 at `groupBy.N.dateGranularity` a `dateGranularity` over a virtual (`formula`) field, whatever its `returnType`, before any driver is asked; `/analytics/sql` (`AnalyticsService.generateSql`) and the draft preview of `queryDataset` give the same refusal, field for field. An engine that aggregates in memory served one `null` group for it, the dry run rendered `strftime('%Y-%m', calc)`, and the preview served one `null` group. Nothing is widened: no export, public member, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of either package root changes: a query that bucketed a column the table does not store is refused before it reaches the driver, with an error code and status already on the wire. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on `engine.aggregate` (`@objectstack/objectql`) and on the `/analytics/sql` dry run and the draft preview (`@objectstack/service-analytics`), for a date bucket over a `formula` field only.

- **Before.** Measured on `main` `7788eedb`, a month bucket over a `formula` with `returnType: 'date'`. On a SQL driver, `/analytics/query` (both compositions) answered the driver's missing-column backstop: `INVALID_FIELD` / 400 with no `path` and a "run schema sync" prescription that cannot help. On an engine whose driver has no native `aggregate` (the in-memory aggregation), the query was served: one `null` group holding every row. The dry run rendered `strftime('%Y-%m', calc)`, and the draft preview served one `null` group holding the total.
- **Now.** The engine's date-bucket door (`assertDateBucketTargetsAreTemporal`) judges a virtual field first, by the spec's `isVirtualSearchField` (`SEARCH_VIRTUAL_TYPES`), the predicate the sort, filter and search axes already refuse a formula by. It refuses with `INVALID_FIELD` / 400 at `groupBy.N.dateGranularity`, naming the field, its type and the granularity. The service's copy of that door (`dataset-date-bucket-door.ts`) refuses the same way, so the dry run and the preview give the query's refusal: the same message, `object`, `param`, `path`, `field` and `fields`.
- **Unchanged.** A date or datetime bucket is served on every face, byte for byte. A plain `groupBy` over a formula (no `dateGranularity`) is not this change's.
- **Who sees it.** A caller bucketing a formula field: a located refusal with a remedy, instead of a driver error, an empty-looking group or SQL for a statement that never runs.

**The remedy.** Denormalise the value onto the object (a stored date or datetime field, written when the source changes) and bucket that.
