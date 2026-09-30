---
"@objectstack/rest": patch
---

fix(rest): `POST /api/v1/data/:object/import` reads a `time` cell by `@objectstack/core`'s one `time` rule, the rule the write door asks, so the `10:00:00.250` that `/export` writes for a `time` with milliseconds re-imports as itself instead of failing its row as `invalid_date` (#20722)

The import's `time` reader was a private pattern with no fractional part. A `time` stored with milliseconds (`10:00:00.250`, which the write door accepts and `/export` writes as it is stored) failed its row on re-import with `Clock: "10:00:00.250" is not a valid time`, on every backend, so an export did not re-import. The reader now asks the same rule the write door asks of a written `time`: `isUninterpretableTemporalComparand('time', …)` for the verdict and `temporalStorageForm(…, 'time')` for the stored value. A cell is admitted exactly when the write door admits the same value, and stored as the same wall clock.

Through the route, the process in America/New_York, SQLite and PostgreSQL 16 (at `Asia/Shanghai`), before and after:

| `time` cell | before | now |
|:--|:--|:--|
| `10:00:00.250`, `23:59:59.999` (what `/export` writes) | row failed, `invalid_date` | stored as written |
| `10:00:00.5`, `10:00:00.000` | row failed, `invalid_date` | `10:00:00.500`, `10:00:00` |
| `2026-07-15T10:00:00.250Z`, `2026-07-15 10:00:00.250` | stored `10:00:00`, the fraction dropped | `10:00:00.250`, as the write door stores it |
| `9999-12-31T23:00:00-02:00` (an instant in UTC year 10000) | stored `01:00:00` | row failed, `invalid_time`, as the write door refuses it |
| `10:00Z`, `10:00+08:00`, `07/15/2026 10:00`, `25:00` | row failed, `invalid_date` | row failed, `invalid_time` |
| `10:00`, `10:00:00`, `2026-07-15T18:00:00+08:00` | `10:00:00` | unchanged |
| `2026/7/15 9:00` (the year-first form) | `09:00:00` | unchanged |

A refused `time` cell now reports the field code the write door gives for the same value, `invalid_time`, where it reported `invalid_date`; the row's sentence is unchanged. A `date` or `datetime` cell keeps `invalid_date`. A time of day with a `Z` or an offset stays refused: a `time` carries no zone. The year-first date-time (`2026/7/15 9:00`) is still read as its wall clock; it is the one reading the import has that the write door has not. The dry run reports the same verdicts.
