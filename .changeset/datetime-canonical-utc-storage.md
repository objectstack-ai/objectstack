---
"@objectstack/driver-sql": minor
"@objectstack/service-analytics": patch
"@objectstack/spec": patch
---

fix(driver-sql): give `Field.datetime` one UTC storage form per dialect (#3912, #3942)

Any window filter on a `Field.datetime` column returned an empty set on SQLite —
a dashboard `dateRange: last_30_days` on `created_date` read 0 while 29 matching
rows existed.

There was never a storage *convention*, only a description of what better-sqlite3
happened to do with a bound JS `Date`. Nothing enforced it — `formatInput`
deliberately left `datetime` untouched — so the form was decided by whichever
writer got there first: a JS `Date` landed as INTEGER epoch ms, while a REST/JSON
write (JSON has no `Date` type), a `defaultValue: 'NOW()'` slot, and the
platform's own `created_at` / `updated_at` all landed as ISO **TEXT**. One column
held both forms while the read path coerced comparands to epoch ms purely from
the *declared* type. On SQLite's type ordering (`INTEGER < TEXT`) a two-sided
window collapsed to zero rows, and a one-sided `>=` matched every TEXT row
regardless of the bound.

`Field.datetime` now has one canonical instant per dialect, produced by one
function applied on write **and** to every filter comparand, so the two sides of
a comparison cannot disagree about shape:

- **SQLite** — `YYYY-MM-DDTHH:MM:SS.sssZ` text. Lexicographic order *is*
  chronological order, so range filters and `ORDER BY` read the column directly
  and can use an index; `strftime` parses it, so the date-bucket expression needs
  no CASE.
- **Postgres** — `timestamptz`, unchanged. The fix here is on the write and
  comparand side: a zone-naive write was previously resolved against the
  *server's* timezone (measured 8 hours off on `Asia/Shanghai`), and an
  un-anchored `YYYY-MM-DD` comparand meant the server's local midnight, so the
  identical query over the identical instant landed a row on a different calendar
  day than SQLite did.
- **MySQL** — `DATETIME(3)` instead of `TIMESTAMP`, a connection pinned to UTC on
  both the mysql2 and the server layer, and a MySQL-spelled bind carrying the
  same UTC wall clock. MySQL accepts neither the `T` separator nor the `Z` suffix
  in a datetime literal, so datetime writes over REST had always failed outright;
  `TIMESTAMP` additionally truncated milliseconds and could not store an instant
  outside 1970..2038.

Existing rows converge at schema sync. Both migrations are allowed to fail: they
log, mark nothing, and the read paths keep a repair expression, so an un-migrated
column still compares and buckets **correctly** — just unindexed. Neither can
repair instants the old timezone-ambiguous write path recorded wrongly; they
preserve what is on disk.

Also closes #3928 (datetime `ORDER BY` mis-sorted on mixed storage) by
construction. Rationale is recorded as ADR-0053 addendum D-B1..D-B4.

The analytics change is additive: a `coerceTemporalFilterColumn` companion to the
existing `coerceTemporalFilterValue` hook, so a raw-SQL strategy can normalise the
column side too. Absent hook → byte-identical SQL.
