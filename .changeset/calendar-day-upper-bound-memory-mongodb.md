---
"@objectstack/driver-memory": patch
"@objectstack/driver-mongodb": patch
---

fix(driver-memory,driver-mongodb): a bare-day upper bound covers the whole day (#4042)

The non-SQL half of #3777's calendar-day rule. Both drivers compiled a bare
`YYYY-MM-DD` `$lte` (and a `between` max) as-is, so on timestamp values the
window cut off at the final day's midnight — the dashboard date-range filter's
default configuration (`created_at`, 7 of 13 presets ending "today") lost the
current day, exactly as it did on SQL before #3777 was fixed.

Both drivers now compile a bare-day upper bound half-open, sharing
`nextUtcCalendarDay` from `@objectstack/core`:

- `driver-memory`: the Mongo-style and array `where` spellings in the mingo
  lowering (`$lte`/`<=` → `$lt` next day; `$between`/`between` max the same),
  the analytics cube-filter `lte`, and the analytics `dateRange` window — which
  now also matches BOTH stored forms of a timestamp (ISO strings and `Date`
  objects) instead of only `Date`s, since mingo compares cross-type as
  never-equal.
- `driver-mongodb`: the `translateFilter` lowering, all three spellings
  (`$lte`, `$between`, array `<=`/`lte`).

Unchanged on purpose, matching the #3777 semantics table: full-ISO/`Date`
comparands keep instant semantics, and `$gte`/`$gt`/`$lt` keep their midnight
anchoring. Known remaining gap (tracked separately): values stored as BSON
`Date` (mongodb) or JS `Date` (memory `find()`) never match *string* comparands
of any operator — a storage-form problem, not a bound-semantics one.
