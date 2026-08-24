---
'@objectstack/driver-sql': minor
---

driver-sql: a string field's declared `maxLength` now shapes the column it gets

`createColumn` mapped the string family — `string` / `email` / `url` / `phone` /
`password` — with a bare `table.string(name)`, so every column took knex's
default width of 255 and the field's own `maxLength` was never read. A field
declaring a wider bound got a narrower column, and on a dialect that enforces
`varchar` length the write was refused: measured through the driver's own
`initObjects` on MySQL 8.0.46 and Postgres 16, a 300-character value written to
a `maxLength: 1024` column came back `ER_DATA_TOO_LONG` and `22001 value too
long for type character varying(255)` respectively. `schema-drift.ts` has always
treated `varchar(field.maxLength)` as the expected physical shape, so every such
column also reported permanent drift against a table the driver had just
created.

**This changes emitted DDL for existing declarations.** A field declaring
`maxLength` now gets `varchar(maxLength)` in both directions — wider *and*
narrower than 255. Only newly created columns are affected: `createColumn` runs
on `CREATE TABLE` and `ALTER TABLE ADD COLUMN`, never on a column that already
holds rows, so nothing is truncated and no existing column is rewritten.
Narrowing a populated column remains what it was — the `narrow_varchar` drift
op, category `destructive`, behind `os migrate apply --allow-destructive`.

A declared bound above 16383 characters (MySQL's utf8mb4 `varchar` ceiling)
makes the column `TEXT` rather than clamping it, since a clamp would reinstate
the same defect. Fields declaring no `maxLength`, or a malformed one, keep
`varchar(255)` exactly as before. `lookup` / `user`, `autonumber`, and the
catch-all branch are deliberately unchanged — none of them stores the value the
declared bound describes.

Two matching corrections in `schema-drift.ts`, so the differ and the emitter
agree on which declarations count: a `maxLength` that is not a positive integer
is no longer read as a bound (`maxLength: 0` planned a destructive `varchar(0)`
ALTER), and a MySQL `TEXT` column is no longer diffed as a `varchar` 65535 wide
— MySQL reports `character_maximum_length` 65535 for `TEXT` where Postgres
reports NULL, so on MySQL alone every bounded unkeyed text column had been
reporting a permanent destructive `narrow_varchar` against itself.
