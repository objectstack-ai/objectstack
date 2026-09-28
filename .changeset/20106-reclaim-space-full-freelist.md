---
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
---

fix(driver-sql, driver-turso): `reclaimSpace()` returns the whole SQLite freelist, not one page per call (#20106)

Clause-②: no

`reclaimSpace()` is what the lifecycle service calls after every sweep that deleted rows (ADR-0057 §3.4). On SQLite it runs `PRAGMA incremental_vacuum`, and that statement frees one page per step. Two clients stepped it once:

- **`SqlDriver` on better-sqlite3, and `TursoDriver` in local mode.** knex's better-sqlite3 client runs a statement that declares no result columns with `Statement.run()`, which steps it once. A database with 300 free pages had 299 after the call, read from a second connection, and the file barely shrank. `incremental_vacuum(N)` freed one page too. The method now drives that binding through its own `exec()`, which steps the statement until SQLite reports done: 300 → 0, and the file shrinks by those pages.
- **`TursoDriver` in remote mode.** The libSQL client's `execute()` stepped the statement once and left it unfinished. Over a libSQL `file:` client, the issuing connection read one page fewer, but a second connection read the freelist and the file size unchanged, and a row written after the call on the same connection never reached the file. The remote route now reads `PRAGMA freelist_count`, sends nothing more when it is `0`, and otherwise runs the vacuum through the client's `executeMultiple()`: 300 → 0 from a second connection, and the later write lands. A server that refuses either statement answers `DATABASE_ERROR` / 500, as before. What a hosted libSQL server does with either call is not measured.

`SqliteWasmDriver` was already complete: its dialect steps every PRAGMA to the end (300 → 0 before and after this change).

Nothing to migrate: `reclaimSpace()` keeps its signature, and a database whose `auto_vacuum` mode is not `INCREMENTAL` still reclaims nothing, as before.
