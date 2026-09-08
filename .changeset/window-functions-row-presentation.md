---
"@objectstack/driver-sql": minor
---

fix(driver-sql)!: `findWithWindowFunctions()` presents its rows like every other read door — a declared boolean answers `true`, not `1` (#16609)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, export, config field or stored metadata changes spelling or shape, `packages/spec` is untouched, no DDL and no stored bytes change, and `objectstack migrate meta` has nothing to rewrite. What moves is the PRESENTATION one driver door applies to values it reads back — `findWithWindowFunctions()` now runs each row through the same `formatOutput` pass `find()` has always run — so the door stops disagreeing with the driver's own declared read contract. The consumer note below is guidance for code that had compensated for the old storage forms; it prescribes no rewrite of any authored artifact. -->

**BREAKING** on the rows returned by `SqlDriver#findWithWindowFunctions()`.
Shipped as `minor` under the repo's launch-window convention for breaking
changes, matching #3849 — the `aggregate()` / `distinct()` half of this same
gap, which graded `minor` for the same boolean-shape move.

**What was wrong.** `findWithWindowFunctions()` was the one record read door
that returned `await builder` with no presentation at all: no `formatOutput`
(which every `find()` / `findOne()` row gets) and no `presentReadValue` (which
`aggregate()` / `distinct()` got under #3797 / #3849). So it handed back
STORAGE forms where every other door hands back the declared type's
presentation. Measured on SQLite against the built package, one row through the
two doors:

```
find():                    { ok: true, closed_at: '2026-01-10T09:00:00.123Z', meta: { k: 1 } }
findWithWindowFunctions(): { ok: 1,    closed_at: '2026-01-10T09:00:00.123Z', meta: '{"k":1}', rn: 1 }
```

A declared `Field.boolean` answered `1` where `find()` answered `true`; a
declared `Field.object` answered the stored JSON TEXT where `find()` answered
the parsed object. On Postgres and MySQL the same door handed out the client
library's `Date` for `Field.datetime` and the audit stamps — the one shape every
other read door no longer produces — so on the live dialects the divergence was
between this door and the driver's own declared read contract, not merely
between dialects.

**What to do.** Code that compensated for the storage forms stops being
correct and should simply drop the compensation:

- `if (row.ok === 1)` → `if (row.ok)`; the value is a real boolean now.
- `JSON.parse(row.meta)` → `row.meta`; it is already the parsed value, and
  parsing an object throws.
- A `Field.datetime` / `Field.date` / `Field.time` / `created_at` / `updated_at`
  read through this door is now the same presented value `find()` gives, so a
  branch that re-normalised it can go.

**The alias columns are carved out**, which is the design question this door
raised. A window alias is a computed value, not a declared field, so no declared
field's presentation rule touches it. When an alias is spelled the same as a
declared field, SQL had already decided which value wins the key — `select *`
plus `<window> as ok` projects two columns named `ok` and the row keeps the
LAST, so the computed value wins and the declared column's value is not in the
row at all. That is unchanged. What is now ruled is that the winning value stays
RAW: presenting a `row_number` of `1` and `2` as the declared boolean would fold
both to `true` and destroy the value the caller asked for. This is the same
ruling `aggregate()` already makes for a date-bucketed column aliased as its own
field name.
