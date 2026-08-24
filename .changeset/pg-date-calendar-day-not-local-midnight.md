---
'@objectstack/driver-sql': minor
---

Stop reading every PostgreSQL `Field.date` one day early on a process east of UTC

On PostgreSQL a `Field.date` came back **one calendar day early** whenever the
Node process ran east of UTC — an app container on `TZ=Asia/Shanghai` served
`"apply_date": "2026-08-23"` for a row `psql` reads as `2026-08-24`. The stored
value was always right; the read corrupted it, so the wrong day was already in
the REST payload before anything rendered it. Worse than a display bug: an
`afterUpdate` hook copying a date into a child record persisted the shifted
value, writing the wrong day back into the database.

`node-postgres` materialises OID 1082 (`date`) as a JS `Date` at **local**
midnight, and `SqlDriver#toDateOnly` reads a `Date` with **UTC** components.
East of UTC, local midnight is the previous day in UTC. Measured on PostgreSQL
16, one stored row `2026-08-24`, only the process `TZ` changed:

| process `TZ` | `pg` materialised | driver returned |
|---|---|---|
| `UTC` | `2026-08-24T00:00:00.000Z` | `2026-08-24` |
| `America/New_York` | `2026-08-24T04:00:00.000Z` | `2026-08-24` |
| `Asia/Shanghai` | `2026-08-23T16:00:00.000Z` | **`2026-08-23`** |

Fixed at the parser rather than the reader: the driver now registers a
connection-scoped type parser so `date` (OID 1082) and `date[]` (1182) arrive
as their `YYYY-MM-DD` wire text and never become a `Date` at all — the same
shape SQLite has always had, and the same shape MySQL already had via the
existing UTC connection pin. `timestamptz` is untouched: an instant is what a
`Date` is for, and `Field.datetime` depends on it. The parser is registered on
the connections this driver opens, never through the process-wide
`pg.types.setTypeParser`, so a host application's own `pg` clients keep stock
behaviour.

Reading local components in `toDateOnly` instead was measured and rejected:
that helper is shared by the read, write and filter paths, and a caller's
`new Date('2026-08-24')` is UTC midnight — local components would report it as
`2026-08-23` west of UTC, i.e. the identical one-day error moved onto the write
and filter paths. `toDateOnly` now documents the UTC clock as its contract.

**If you worked around this, you can undo the workaround.** Running the app
process with `TZ=UTC` is no longer a prerequisite for correct dates, and any
app-side "+1 day" compensation on a PostgreSQL date read must be removed — with
this release the driver returns the stored day, so a compensating shift now
overshoots. Rows that were *written* through the old skew (a hook that copied a
date it had just read) still hold the wrong day and need a data fix; nothing
here rewrites stored data.

One behaviour change beyond the corrected day: on PostgreSQL a raw read
(`driver.execute(...)`, or knex used directly on this driver's connection) now
yields a `string` for a `date` column where it previously yielded a `Date`.
Values leaving `find()` / `findOne()` / `aggregate()` / `distinct()` were
already normalised to `YYYY-MM-DD` strings and keep that type — only the day
they name changes.

Pinned by a process-zone matrix (`UTC`, `Asia/Shanghai`, `America/New_York`,
`Asia/Kolkata`) that asserts it contains an east-of-UTC cell before it believes
itself: the existing live-Postgres CI job runs at `TZ=America/New_York`, which
is west of UTC, where the pre-fix read names the right day — which is why this
was green in CI for as long as it was broken in production.
