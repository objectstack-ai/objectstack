---
'@objectstack/service-analytics': patch
---

With a non-UTC `timezone`, the analytics SQL echo of a date-bucketed dimension refuses on every dialect instead of printing `date_trunc` (#21630).

Clause-②: no

- **What was wrong.** With a non-UTC `timezone`, the engine buckets a date dimension in memory on that zone's calendar, on every driver. The ObjectQL face of `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` still echoed the bucket as `date_trunc('month', col)` (or the asked granularity) on PostgreSQL and MySQL, a statement the engine never ran. On PostgreSQL that statement groups on the database session's calendar: measured on PostgreSQL 16.14 with the server at `Asia/Shanghai`, it answered timestamp keys such as `2025-12-31T16:00:00.000Z` where the query answered `2026-01`, and with `timezone: 'America/New_York'` it grouped the rows differently from the query. MySQL has no `date_trunc` at all. SQLite already refused this echo.
- **What it does now.** For a date-bucketed dimension with a non-UTC `timezone`, on every dialect:
  - `POST /api/v1/analytics/sql` refuses with `NOT_IMPLEMENTED` / 501, declared as a refusal so its message reaches the caller. This is the answer SQLite already gave.
  - `POST /api/v1/analytics/query` answers the same rows as before, and its answer carries no `sql`.
- **Unchanged.** A query sent with `timezone: 'UTC'`, or with no `timezone`, still echoes the expression the driver groups by: `to_char(…)` on PostgreSQL, `date_format(…)` on MySQL and `strftime(…)` on SQLite.
