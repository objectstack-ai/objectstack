---
"@objectstack/cli": patch
---

fix(cli): `os generate migration` now emits the columns the platform actually creates for `autonumber`, `multiselect`, `vector`, `formula` and the reference types

Five entries in the CLI's field-type vocabularies keyed on real `FieldType`
members and described DDL the platform does not create. #13871 removed entries
naming types that do not exist and #14657 added entries for real members that
had none, deliberately leaving every pre-existing entry alone; this is the third
direction, and every value below is now read from
`packages/drivers/driver-sql/src/sql-driver.ts`, the emitter that creates the
real columns.

- `autonumber` was `SERIAL`. The runtime issues a **rendered string** — prefix,
  counter, suffix — and `createColumn` gives it `table.string(name)`. A SERIAL
  is an integer column with a sequence attached, so Postgres answered
  `22P02 invalid input syntax for type integer` for `INV-0001`. The file already
  contradicted itself here: `os generate types` has always called this member a
  `string`. Now `VARCHAR(255)`.
- `multiselect` was `TEXT`. `MULTI_OPTION_TYPES` seeds the driver's
  `JSON_COLUMN_TYPES`, so the runtime writes a JSON array. A text column is the
  silently corrupting shape — `schema-drift.ts` gates its own multi-value
  finding on exactly `char|text` because "the textual family is the one that
  says yes and corrupts" — and the array landed as the literal `'["a","b"]'`,
  read back as one opaque string. Now `JSONB`.
- `vector` was `VECTOR`. `vector` is in `STRUCTURED_JSON_TYPES`, hence a JSON
  column. `VECTOR` also needs the pgvector extension and does not exist on MySQL
  or SQLite, so the generated `CREATE TABLE` failed outright off Postgres. Now
  `JSONB`.
- `lookup` and `master_detail` took `table.uuid` in the TypeScript migration.
  This was the one hard failure: a platform id is 26 characters, and Postgres
  refuses one in a `uuid` column with `22P02` on the first insert. Both now take
  the driver's own answer for a reference column, `table.string` /
  `VARCHAR(255)` — and `user` / `tree` move with them, because a reference
  column holds the target's `id`, which the driver emits as
  `table.string('id').primary()`. One class, one answer.
- `formula` was given a column. It is **virtual**: `createColumn` answers
  `case 'formula': return;` and `schema-drift.ts`'s `fieldHasColumn` answers
  false for it, so the generated migration created a column the runtime never
  writes to. Both migration generators now emit nothing for it, carried as the
  vocabulary's own `null` answer so the two cannot disagree about which fields
  materialise. A `formula` field is still declared on the generated record type
  — it is readable, just not stored.

A generated migration is scaffolding you run once and then own, so this changes
what the **next** generation emits and reaches into no database that has already
migrated. A project that has run an older generated migration keeps its columns;
where they differ from the platform's, `os migrate plan` reports the drift.

The values are pinned rather than restated: `generate-field-type-vocabulary.pin.test.ts`
sweeps the spec's ADR-0104 D1 value classes and reads the driver's own switch,
so a fourth hand-carried table of right answers cannot arrive. The file family
(`file` / `image` / `avatar` / `video` / `audio`) is deliberately unchanged and
recorded as an open divergence rather than corrected — the driver is pre-D3
there and the generator is post-D3, which is a decision, not a wrong value.
