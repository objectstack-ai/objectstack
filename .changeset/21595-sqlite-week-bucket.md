---
'@objectstack/driver-sql': patch
'@objectstack/service-analytics': patch
---

On SQLite, a `week` date bucket is grouped in SQL, and the analytics SQL echo never prints a bucket statement that SQLite refuses (#21595).

Clause-②: no

- **What was wrong.** `driver-sql` grouped `day`, `month`, `quarter` and `year` in SQL on SQLite, but not `week`. Its `supports.queryDateGranularity` said `week: false`, so the engine bucketed weeks in memory, and the ObjectQL face of `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` echoed the bucket as `date_trunc('week', col)`. SQLite has no `date_trunc`, so that echo could not run. A non-UTC `timezone` on SQLite gave the same echo for every granularity.
- **What it does now.**
  - SQLite advertises all five granularities. `week` buckets as `YYYY-Www`, the ISO 8601 week that the PostgreSQL and MySQL arms answer. The expression does not use `strftime('%V')`, which needs SQLite 3.46: `@libsql/client` 0.18.0 bundles SQLite 3.45.1, where `%V` answers NULL. It runs on better-sqlite3, on libSQL (`driver-turso`) and on sql.js (`driver-sqlite-wasm`). A `Field.date` still buckets as its own calendar day.
  - The echo prints that expression for a `week` bucket on SQLite, and the statement runs.
  - With a non-UTC `timezone` on SQLite, `POST /api/v1/analytics/sql` refuses with `NOT_IMPLEMENTED` / 501, declared as a refusal so its message reaches the caller. `POST /api/v1/analytics/query` still answers the rows, and its answer carries no `sql`. The engine buckets on that zone's calendar in memory, and SQLite has no time-zone database, so no SQLite statement produces those keys.
- **Where it shows.** `aggregate()` with a `week` group on SQLite, `SqlDriver.dateBucketSql()`, and the analytics SQL echo. A query sent with `timezone: 'UTC'`, or with no `timezone`, still echoes the driver's own expression.
