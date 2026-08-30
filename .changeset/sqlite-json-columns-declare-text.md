---
'@objectstack/driver-sql': minor
'@objectstack/driver-turso': minor
'@objectstack/driver-sqlite-wasm': minor
---

feat(driver-sql,driver-turso,driver-sqlite-wasm): SQLite-family JSON columns declare `TEXT`; server dialects keep native JSON (#12738)

A `Field.json` column — and any field with `multiple: true` — is now declared as
the JSON column type the **target dialect actually has**. Postgres and MySQL are
untouched: their native `json`/`jsonb` and `JSON` types are correct and stay.
The SQLite family (plain `SqlDriver` on `sqlite3`/`better-sqlite3`, `TursoDriver`
in all three transport modes, and `SqliteWasmDriver`) now declares `text`.

**Why.** SQLite has no JSON type. It derives a column's *affinity* from
substrings of the declared type name, and `json` contains none of the markers
(`INT`, `CHAR`/`CLOB`/`TEXT`, `BLOB`, `REAL`/`FLOA`/`DOUB`), so it fell through
to **NUMERIC** and converted number-like input on the way in — measured through
raw SQL, a bare `'0123'` was stored as the integer `123`. `text` takes TEXT
affinity, converts nothing, and is what SQLite's own JSON1 functions operate on.
It is also what `RemoteTransport.mapFieldTypeToSQL` had spelled all along, so
turso's two transports now agree instead of diverging on one column.

## The migration shape

- **New columns only.** The change is to the DDL emitter. Schema sync is
  additive, so no existing column is altered, dropped or rewritten.
- **Existing columns keep their declared type.** A column created before this
  release stays `json` and keeps NUMERIC affinity — including through an
  unrelated SQLite drift rebuild, which re-declares an introspected `json`
  column as `json` rather than converting it.
- **Platform write-path behaviour is unchanged.** The `Field.json` codec stays
  injective and stays in force: what the platform writes and reads back is
  identical before and after, on legacy and new columns alike. Nothing on the
  read path consults the physical column type — `isJsonField` answers from
  metadata — so decoding is the same on both spellings.
- **No new schema-drift findings.** The multi-value base-type finding is gated
  on the dialect where the column type is load-bearing (Postgres and MySQL);
  SQLite was already excluded, and the emitter now agrees with the differ
  instead of merely being excused by it.
- **The visible difference is raw-SQL-only, and in the safe direction.** A value
  written to a JSON column by raw SQL (bypassing the driver) is preserved as
  text on a new column where it would previously have been coerced to a number.
  Nothing that was preserved before is coerced now.
