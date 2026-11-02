---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the /analytics/sql dry run refuses a date bucket over a column that is not a date or datetime, as the query does, instead of rendering it

Clause-②: no (narrowing) — `/analytics/sql` (`AnalyticsService.generateSql`) now refuses `INVALID_FIELD` / 400 at `groupBy.N.dateGranularity` a time-dimension granularity over a field declared neither a date nor a datetime (text, select, number, boolean, time, …), with the refusal `/analytics/query` gives the same selection, field for field; it rendered a statement for it (or, at a non-UTC zone, answered `NOT_IMPLEMENTED` / 501 saying the query is served). Nothing is widened: no export, public member, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package root changes: a dry run that rendered a statement the query refuses is refused with the query's refusal, already on the wire. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the `/analytics/sql` dry run (`@objectstack/service-analytics`). `/analytics/query` is unchanged.

- **Before.** Measured on real SQLite on `main` `ab085a04`. `/analytics/query` refused a month bucket over a text, select or boolean column, a year bucket over a number and a day bucket over a `time` column with the engine's `INVALID_FIELD` / 400 at `groupBy.N.dateGranularity`. The dry run rendered `strftime('%Y-%m', region)` and its kin, on the direct and the cross-object path, and for a cube dimension's one declared granularity asked raw. At `America/New_York` it answered `NOT_IMPLEMENTED` / 501.
- **Now.** The dry run judges the keys `execute()` hands the engine (its cross-object path's when the selection routes there) with the reading the draft preview already used (#28852), now `dataset-date-bucket-door.ts`. It runs after the dry run's `dateRange` read and its column-asked-twice refusal, as `query()` refuses, and gives the engine's refusal: the same message, `object`, `param`, `path`, `field` and `fields`. A field with no declared type is not judged, as in the engine; a `formula` is refused with the engine's virtual-field refusal on every face (#29167).
- **Unchanged.** A date or datetime bucket renders byte for byte, the statement the query echoes.
- **Who sees it.** A caller of the dry run for a selection the query refuses: the query's refusal, instead of SQL for a statement that never runs.

**The remedy.** Group by the column without a granularity, or bucket a date or datetime field.

Also in this change, the draft preview of `queryDataset` lowers its row filters (the `where`, then the time-dimension windows) once, before its column-asked-twice and date-bucket refusals, where the ObjectQL strategy lowers them. So a selection carrying an unrecognised `dateRange` beside one column asked twice or beside a bucket over a non-date column is refused about the `dateRange` (`ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400) on every face, and a refused filter beside a non-date bucket is refused about the filter. The preview answered the other refusal.
