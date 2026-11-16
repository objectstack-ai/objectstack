---
'@objectstack/driver-turso': patch
---

fix(driver-turso): Turso's remote face relaxes a NOT NULL column in place, so a package upgrade that makes a field optional reaches hosted databases

Clause-②: yes (widening)
Metadata-protocol: none

On Turso's remote face (`libsql://`, every hosted tenant database), a `relax_not_null` drift entry is now applied. Until now it was skipped with "it needs the SQLite table rebuild, which the Turso REMOTE transport does not run". A package upgrade that declares `storage: { notNull: false }` on a column therefore left the column NOT NULL on a hosted database, and every save that left the field empty failed.

The maintainer ruled how (decision record 6915086281 on #33724): the column is relaxed in place with libSQL's own column statement, `ALTER TABLE t ALTER COLUMN c TO c <definition>`, and no table rebuild runs.

- **Only the NOT NULL clause changes.** The definition sent is the column's own, cut from the table's stored `CREATE TABLE` with only its `[CONSTRAINT name] NOT NULL [ON CONFLICT …]` clause removed. The type, the DEFAULT, and any CHECK, COLLATE, UNIQUE or REFERENCES clause stay byte for byte. No row is copied or revalidated.
- **Applied only on a read-back.** The statement is sent in one `write` batch with a check that the table's stored SQL now reads exactly as planned. If it reads any other way, the batch rolls back. The entry is reported `applied` only when the column then reads back nullable, with the type, the DEFAULT and the primary-key position it had before.
- **A refusal is reported, and nothing falls back.** A statement the database refuses, a stored definition the plan cannot read, or a read-back that differs is reported `skipped`, and the reason is logged. Measured on libSQL (SQLite 3.45.1): libSQL ends the old definition at the first comma after the column's name, so a column whose definition holds a comma (in a DEFAULT, a CHECK, a type width such as `NUMERIC(10, 2)`, or a comment) is refused that way, and a real `sqld` 0.24.33 refuses it the same way. It keeps its NOT NULL, the table is left byte-identical, and the logged reason says the definition holds a comma. The maintainer accepted this limit (decision record 6922037129 on #33724): no table rebuild is added for such a column. Columns this face creates are `TEXT`, `INTEGER` or `REAL` with no DEFAULT and no width, so they are never in it.

The same three acts reach the relax as before: a managed install or upgrade of a package that declares `storage: { notNull: false }` on the column, the publish of an environment-authored object, and `os migrate apply`. A boot still never alters a column (ADR-0113 D5). On the remote face, `TursoDriver.applyMigrationEntries` now applies a `relax_not_null` entry, and `TursoDriver.driftApplyLimit('relax_not_null')` answers `null` where it answered the table-rebuild sentence. So `os migrate plan` and the apply's listing show a relax on a remote database with no transport limit, and count one fewer change they cannot apply.

A tightened NOT NULL, a dropped DEFAULT, and the type and width entries keep their answer on this face: skipped, because they need the table rebuild. The statement does not revalidate existing rows, so it is never used to tighten. A local SQLite file keeps the existing table rebuild for every column entry.
