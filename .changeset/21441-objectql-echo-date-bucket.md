---
"@objectstack/service-analytics": minor
"@objectstack/driver-sql": minor
"@objectstack/driver-turso": patch
---

fix(service-analytics): the ObjectQL face echoes a date-bucketed dimension in the bucket expression the driver itself groups by, so SQLite runs the statement it prints

Clause-②: yes (widening)

**Before**, the ObjectQL strategy printed every date-bucketed dimension as `date_trunc('<granularity>', col)` in the `sql` it echoes and in the `POST /analytics/sql` body, on every dialect. The native strategy declines a granularity, so every bucketed query lands on this face. Measured through `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` in the default composition: the rows were right. On SQLite the echo failed with `no such function: date_trunc` (month, quarter and week). On PostgreSQL 16.14 it ran but answered `2026-01-01T00:00:00.000Z` where the face answers `2026-01`. The driver groups by `strftime('%Y-%m', …)` on SQLite and `to_char((…)::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM')` on PostgreSQL.

**Now** the echo prints the driver's own expression, so it runs on that dialect and answers the face's bucket keys.

- **`@objectstack/driver-sql`**: `SqlDriver.dateBucketSql(objectName, field, granularity)` returns the expression `aggregate` groups by, rendered as SQL text: the existing `buildDateBucketExpr`, unchanged, with each identifier quoted by the dialect. It returns `null` for a granularity the dialect buckets in memory (`week` on SQLite). The MySQL arm (`date_format(convert_tz(…))`) is checked by code read only, because no MySQL server was available.
- **`@objectstack/service-analytics`**: the new optional `AnalyticsServiceConfig.dateBucketSql` hook carries the expression to the ObjectQL strategy. `AnalyticsServicePlugin` wires it from the driver that serves the object, as it wires `sqlDialect`.
- **`@objectstack/driver-turso`**: a comment that said `SqlDriver` buckets with `date_trunc` now names the SQLite `strftime` expression it emits. The inherited `dateBucketSql` answers on the remote face too: it renders the same SQLite expression with no connection, and libSQL runs it.

**Unchanged.** The rows every face answers. The echo keeps `date_trunc(…)` where nothing answers: a host that wires no hook, a driver with no bucket expression (memory, MongoDB), a granularity the driver buckets in memory, and a query with a non-UTC `timezone`, which the engine buckets in memory on that zone's calendar.
