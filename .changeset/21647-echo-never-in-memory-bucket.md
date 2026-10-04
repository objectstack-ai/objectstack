---
'@objectstack/service-analytics': patch
---

The analytics SQL echo prints a date bucket only in the expression the driver itself groups it by, and refuses everywhere else, including on the in-memory and MongoDB drivers (#21647).

Clause-②: no

- **What was wrong.** At a `timezone` of `UTC`, or with none, the ObjectQL face of `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` echoed a date-bucketed dimension as `date_trunc('month', col)` (or the asked granularity) wherever the driver renders no bucket expression of its own, and documented that as representative. On `driver-memory` the engine only fetches the rows and buckets them itself, answering keys such as `2026-01` and `2026-W02`, while both faces printed `date_trunc(...)`, a statement nothing ran. `driver-mongodb`, which groups the bucket in its own aggregation pipeline, took the same path. So did any host that wires no `dateBucketSql` hook.
- **What it does now.** Wherever no driver expression stands for the bucket, on every driver and dialect:
  - `POST /api/v1/analytics/sql` refuses with `NOT_IMPLEMENTED` / 501, declared as a refusal so its message reaches the caller. Its message names the cause. A non-UTC `timezone` and SQLite already answered this way.
  - `POST /api/v1/analytics/query` answers the same rows as before, and its answer carries no `sql`.
- **Unchanged.** On PostgreSQL, MySQL and SQLite at `UTC` or with no `timezone`, the echo still prints the expression the driver groups by: `to_char(...)`, `date_format(...)` and `strftime(...)`.
