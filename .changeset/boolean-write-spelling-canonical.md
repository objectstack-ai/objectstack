---
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
---

fix(driver-sql)!: a boolean field is stored as a boolean whatever spelling the caller sends

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the write door of the SQLite-family drivers (SqlDriver on SQLite, both faces of TursoDriver, SqliteWasmDriver) for a direct caller: a value on a declared boolean or toggle field that spells no boolean is refused instead of stored, and the spellings it accepts are stored as the boolean they spell. The engine's own door already refuses those values with invalid_boolean, so no authored metadata, seed or stored row is rewritten and nothing needs a tombstone. -->

**BREAKING** for a caller that writes through a SQLite-family driver directly (`create`, `update`, `upsert`, `bulkCreate`, `bulkUpdate`, `updateMany`) and sends a declared `boolean` / `toggle` field a value that spells no boolean, such as `'yes'`, `'TRUE'`, `''`, `2` or an array: it used to be stored as written and is now refused with `VALIDATION_ERROR` / 400 before anything is written. It ships `patch` because it is a non-protocol breaking change (AGENTS.md Post-Task Checklist step 3): no metadata author writes a driver call, so `Metadata-protocol` is `none`, and the engine's door already refuses those values.

A declared scalar `Field.boolean` / `Field.toggle` is now stored as a boolean on SQLite whatever spelling the write sends. `true` / `false`, the numbers `1` / `0` and the text `'1'` / `'0'`, `'true'` / `'false'` and `'1.0'` / `'0.0'` are bound as the boolean they spell, so a column the driver created holds the INTEGER `1` / `0` and a `text` column retyped to `boolean` holds the text `'1'` / `'0'`. These are the spellings the local boot convergence already rewrites, read from the same table. Before, a string reached the column as text, on the local and the remote face of `TursoDriver` alike, so filters, sorts and groups did not read the row as the boolean it was written as. That includes a `beforeInsert` / `beforeUpdate` hook that assigns a string to such a field: the engine's own rewrite runs before the hooks, so the assignment now lands as a boolean too. On the remote face, a number written to a `toggle` field is stored as `'1'` / `'0'` instead of `'1.0'` / `'0.0'`.

A remote `TursoDriver.bulkCreate` checks every row before it writes the first one, so a refused row refuses the batch with nothing written, as the local face's single INSERT already did. `null` still writes NULL. Rows stored before this change keep their stored form.

To keep a direct write working, send `true` or `false` (or one of the spellings above) for a boolean or toggle field.
