---
'@objectstack/spec': minor
'@objectstack/driver-sql': patch
'@objectstack/objectql': patch
'@objectstack/service-analytics': patch
---

Clause-②: yes (widening)
Metadata-protocol: added — `supports.zonedDateBucketing` is a new key a driver author can write on `DriverCapabilities` (`DriverConfig.capabilities`), recorded in `packages/spec/authorable-surface/data.json`.
Skills-docs: none — no skill under `skills/**` teaches driver capability bits or where a zoned date bucket runs; the bit is read by the engine, and an app author writes the same `timezone` as before.

PostgreSQL now buckets a non-UTC reference timezone in the database (ADR-0053 Phase 2 D2 as amended). A dashboard grouped by day, week, month, quarter or year in a zone such as `Asia/Taipei` or `Europe/Berlin` no longer pulls every scoped row into the application on PostgreSQL: the bucket is computed by `to_char((col)::timestamptz AT TIME ZONE $zone, …)` with the zone bound, DST-correct, and its labels equal the in-memory ones. A `Field.date` keeps its calendar day under every zone.

- `@objectstack/spec`: new driver capability bit `supports.zonedDateBucketing`, and `DriverAggregateQuery` (a `DriverQuery` plus `timezone`), the query `IDataDriver.aggregate` receives. Additive; existing drivers keep compiling and keep today's path.
- `@objectstack/objectql`: `engine.aggregate` resolves the request's `timezone` through the runtime first. A name that resolves to `UTC` (`Etc/UTC`, `GMT`, `Zulu`) takes the native UTC path; an area/location name (`CST` resolves to `America/Chicago`) is pushed down as the resolved name to a driver that declares the bit; anything else stays in memory, as before.
- `@objectstack/driver-sql`: declares the bit on PostgreSQL only. SQLite (no tz database), MySQL, SQL Server and Oracle keep the in-memory path. A zoned `aggregate()` call made directly against a dialect without the bit is refused `NOT_IMPLEMENTED`/501, and a zone string that is not its own resolved area/location name is refused `INVALID_QUERY`/400, instead of being read as UTC.
- `@objectstack/service-analytics`: the `/analytics/sql` dry-run refusal for a non-UTC zone now says the query is bucketed in the database or in memory depending on the driver.
