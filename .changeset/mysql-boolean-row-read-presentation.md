---
"@objectstack/driver-sql": patch
---

fix(driver-sql): a declared `Field.boolean` answers JSON booleans on MySQL's row-read doors (#11782)

`formatOutput`'s boolean read coercion — and its per-column mirror
`readPresentationKind`, which `distinct()` and the aggregate group-key /
`min`/`max` tracking consume — was gated `isSqlite`-only. On MySQL the storage
is `tinyint(1)` and mysql2 hands back a JS number, so a declared boolean
answered `1`/`0` through `find()`, `distinct()` and aggregate group keys while
SQLite and Postgres answered `true`/`false` — and, after #11635 presented
aggregate `min`/`max` on every dialect, `max(flag) === true` and
`row.flag === 1` disagreed on the same column over the same MySQL connection.

Measured on live MySQL 8.0.46 before the fix: `find().flag` → `1` (`typeof
number`), `distinct('flag')` → `[0, 1]`, aggregate group keys → `1`/`0`. The
boolean presentation now runs on the two dialects whose stored boolean is a
number (SQLite `INTEGER` 0/1, MySQL `tinyint(1)`); Postgres stores a real
`boolean` node-pg already parses, so it deliberately stays outside the gate and
its answers are byte-identical. A `NULL` boolean stays `null` on every door
(absence is not `false`), and declared `number`/`string` columns are untouched.
