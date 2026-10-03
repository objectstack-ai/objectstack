---
'@objectstack/driver-sql': patch
---

A `Field.date` grouped by `day`, `week`, `month`, `quarter` or `year` buckets as its own calendar day on PostgreSQL and MySQL, whatever zone the server or the session is in (#21485).

Clause-②: no

- **What was wrong.** The PostgreSQL bucket cast every column to `timestamptz` and the MySQL bucket passed every column through `convert_tz`. A `date` has no instant, so both invented midnight in the session's zone, and on a session east of UTC the conversion to UTC read the previous day. On PostgreSQL with the server at `Asia/Shanghai`, `2026-06-01` grouped into month `2026-05`, and `2026-01-01` into year `2025`. MySQL did the same once the session zone was `+08:00`; the driver pins its own sessions to UTC, so there it took a host `pool.afterCreate` that sets the session zone.
- **What it does now.** A declared `Field.date` buckets its calendar day with no zone conversion. A `Field.datetime`, and a column with no declaration, keep the UTC-instant expression, byte for byte. SQLite already bucketed a `date` as its calendar day and is unchanged.
- **Where it shows.** `aggregate()` with a `dateGranularity` group, and the expression `SqlDriver.dateBucketSql()` renders for the analytics SQL echo, which reads the same expression.
