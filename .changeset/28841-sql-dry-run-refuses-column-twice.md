---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the `/analytics/sql` dry run refuses a selection asking one column twice, as `/analytics/query` does, instead of rendering a statement the query refuses

Clause-②: no (narrowing) — `/analytics/sql` (`AnalyticsService.generateSql`) now refuses `INVALID_QUERY` / 400 a selection that names one column twice in its groups (two granularities of one time dimension, the column raw beside its own bucket, or two spellings of it bucketed twice), with the refusal `/analytics/query` gives the same selection, field for field; it rendered a statement for each. Nothing is widened: no export, public member, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package root changes: a dry run that rendered a statement the query refuses is refused with the query's refusal, already on the wire. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the `/analytics/sql` dry run (`@objectstack/service-analytics`). `/analytics/query` and `queryDataset` are unchanged.

- **Before.** Measured on real SQLite on `main` `7e60dc23` (native declines every bucketed selection, so the ObjectQL strategy's echo answers). `/analytics/query` refused each selection below, and the dry run did this instead:
  - `timeDimensions` `closed_at` by month and by year: rendered one `year` bucket, the month entry dropped.
  - `closed_at` raw beside `CUBE.closed_at` by month, or a second dimension over `closed_at` beside its bucket: rendered `GROUP BY closed_at, strftime('%Y-%m', …)`.
  - `closed_at` by month beside `CUBE.closed_at` by year: rendered both buckets.
  - Beside a cross-object `account.name`: rendered the join and one bucket.
  - At a non-UTC `timezone`: answered `NOT_IMPLEMENTED` / 501, saying the query is served.
- **Now.** The echo judges the keys `execute()` hands the engine with the same dataset door (`dataset-group-column-door.ts`, #28798) before it renders a bucket, so it answers the query's `INVALID_QUERY` / 400 with the same message, `object`, `param`, `path` and `fields`. On a selection that routes to the cross-object path, those are that path's keys. The echo's one-granularity-per-dimension map is gone: it reads the granularities the query's key builders read.
- **Unchanged.** Every echo the query serves renders byte for byte (pinned): one bucket of a column, buckets of two columns, one granularity asked twice, raw columns, a cross-object dimension. The 501 for a bucket the engine groups in memory is unchanged when the selection names no column twice. No new refusal is added; the query's own now reaches the dry run.
- **Who sees it.** A caller of `/analytics/sql` sending one of those selections now gets the query's refusal, instead of SQL for a query that does not run.

**The remedy.** Ask each column once: drop the raw dimension or the bucket's granularity, or ask one granularity. The refusal names the members.
