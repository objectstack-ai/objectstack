---
"@objectstack/spec": patch
---

fix(spec): `nextUtcCalendarDay` and `utcInstantMs` read a bare day in the years 0001..0099 as written, not as 1900..1999

`nextUtcCalendarDay` proves a bare `YYYY-MM-DD` is a real day by building it and reading it back. It built the date with `Date.UTC`, which reads a year from 0 to 99 as 1900 + year, so `0050-01-01` came back as `1950-01-01`, the round trip failed, and the helper answered `null` for every day of those years. `utcInstantMs` asks the same round trip about a bare day, so it answered `null` for them too. The date is now built with `setUTCFullYear`, which takes the year as written; an impossible day (`0050-02-30`, `0100-02-29`) is still refused, not rolled over.

What an author sees: a `datetime` filter `$lte '0050-01-01'`, or a `$between` whose maximum is that day, now includes the whole day, as it already did for `'2026-07-15'`. Before, it stopped at the day's first instant, so a row stored at `0050-01-01T10:00:00.000Z` was missed. Measured through `POST /api/v1/data/:object/query` on SQLite and PostgreSQL 16: `$lte '0050-01-01'` answered only the row of `0049-12-31` and now also answers the two rows of `0050-01-01`; `$between ['0050-01-01', '0050-01-01']` answered no rows and now answers both. The next day's midnight stays out, and the 2026 control answers the same before and after. The other callers of the two helpers (the memory and mongo drivers, the analytics strategies, the engine's `having` filter and `formula`'s RLS `check` evaluator) import them from this package, so the correction reaches them with no change of their own.
