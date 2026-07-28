---
"@objectstack/driver-sql": patch
"@objectstack/objectql": patch
---

fix(driver-sql): bucket a SQLite `Field.datetime` by its stored instant instead of collapsing every row into one `(null)` (#3773)

On SQLite, any trend chart bucketed by day/week/month/year over a
`Field.datetime` column put **every record in a single `(null)` bucket** — one
bar, carrying the whole total. The measure was right; only the bucket key was
wrong. `Field.date` (ISO TEXT storage) was unaffected, so the same dashboard
could show one column working and the next one flat.

better-sqlite3 stores a `Field.datetime` as INTEGER epoch **milliseconds** (knex
binds a JS `Date` as `.getTime()`), and `buildDateBucketExpr` emitted a flat
`strftime('%Y-%m', col)`. SQLite reads a bare integer as a **Julian day
number**; an epoch-ms value is far outside the legal range, so `strftime`
returned NULL for every row. Nothing downstream noticed: SQLite advertises
`queryDateGranularity.month`, so `engine.aggregate` pushes the bucketing down,
and its in-memory fallback only engages for an *unsupported* granularity or a
non-UTC timezone.

The SQLite expression is now storage-aware, sharing one `isEpochStoredDatetime`
predicate with the filter-comparand coercion added for the same root cause in
\#2034 — a window and a bucket that disagree about storage is exactly how an
epoch column ended up correctly filtered and then entirely bucketed as NULL.
Postgres and MySQL are untouched: `defineColumn` maps `Field.datetime` to a
native timestamp there, which is also why their comparands are left alone.

Two details are load-bearing and pinned by tests:

- The conversion dispatches on each **stored value's** type, not just the
  declared one. A SQLite `Field.datetime` column is genuinely mixed-form —
  `formatInput` passes datetime values through, so a `Date` lands as INTEGER
  while an ISO string (including an unresolved `defaultValue: 'NOW()'`) lands as
  TEXT. Dividing TEXT by 1000 coerces it to its leading year, filing live rows
  under 1970 — worse than the NULL it replaced.
- Division is `/1000.0`, not `/1000`. Integer division truncates toward zero, so
  a pre-1970 instant (`-1` ms) would surface as 1970-01-01.

`bucketDateValue` (the in-memory fallback in `@objectstack/objectql`) now reads a
finite **number** as epoch milliseconds. `new Date(String(1767225600000))` is an
Invalid Date, so a driver handing back raw storage values bucketed as `'(null)'`
there while the pushed-down SQL bucketed correctly — fixing only the driver would
have traded one wrong answer for two different ones, and the two paths have to
label the same instant identically for a drill-down to survive crossing them.

`SqliteWasmDriver` inherits `buildDateBucketExpr`, so it carried the bug and gets
the fix.
