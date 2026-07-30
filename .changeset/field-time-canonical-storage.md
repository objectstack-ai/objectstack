---
"@objectstack/driver-sql": minor
"@objectstack/cli": patch
"@objectstack/spec": patch
---

fix(driver-sql): `Field.time` gets a canonical storage form — `HH:MM:SS[.fff]` wall-clock text on every dialect (#3994)

`Field.time` repeated the pre-#3912 `Field.datetime` pattern: writes were never
normalised and only reads were repaired, so one SQLite column accumulated bare
time-of-day TEXT, full-timestamp TEXT and INTEGER epoch ms side by side.
`find()` looked right; everything that compared the STORED form was wrong —
measured: a business-hours window filter silently dropped 4 of 7 rows, ORDER BY
sorted 14:30 before 08:00, a full-ISO write failed the statement outright on
both Postgres and MySQL, a bound `Date` stored a process-timezone wall clock on
pg, MySQL's bare `TIME` rounded `…00.500` up to `…01`, and a `NOW()` default
resolved against three different clocks on the three dialects.

The #3912→#3942→#3954 construction, transplanted (ADR-0053 D-C1..D-C3):

- One `canonicalTimeOfDay` — `HH:MM:SS`, `.fff` only when non-zero; `Date`/
  epoch/full-timestamp fold to the UTC time-of-day — applied on write
  (`formatInput`), to filter comparands (`coerceFilterValue`, and thereby the
  `temporalFilterValue` contract hook) and on read (`toTimeOnly`).
- SQLite: legacy columns converge at schema sync (`backfillCanonicalTimes`,
  same `IS NOT`-guarded UPDATE, same log-and-swallow policy); until then the
  filter paths wrap the column in the repair expression — correct, just
  unindexed. `os migrate plan` lists the work as `normalize_time_storage` with
  a row count.
- MySQL: new time columns are `TIME(3)`; legacy `TIME(0)` columns widen at
  schema sync (`migrateMysqlTimeColumns`, plan kind `widen_time_columns`),
  since zero-precision TIME *rounds* fractional writes.
- `NOW()` defaults read the UTC clock on every dialect (Postgres previously
  used the server zone, MySQL the inserting session's zone — and MySQL 8.0
  rejects a plain `CURRENT_TIMESTAMP` default on TIME entirely).
- `distinct()`/`aggregate()` present time columns exactly as `find()` does.

`HH:MM:SS` writes round-trip byte-identically (the field-zoo `f_time`
contract); a minutes-only `HH:MM` now completes to `HH:MM:00`, and uninterpretable
values still pass through untouched.
